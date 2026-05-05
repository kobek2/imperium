"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ChatRow = {
  id: string;
  user_id: string;
  body: string;
  author_display: string;
  created_at: string;
  reply_to_id: string | null;
  reply_parent?: { id: string; body: string; author_display: string; user_id: string } | null;
};

type ProfileMention = {
  id: string;
  character_name: string;
  discord_username: string | null;
};

type ReactionDbRow = {
  message_id: string;
  user_id: string;
  emoji: string;
};

type EmojiAgg = { emoji: string; count: number; me: boolean };

const MAX_LEN = 500;
const FETCH_LIMIT = 60;
const MENTION_DEBOUNCE_MS = 200;
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "👀"] as const;

function escapeIlike(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function mentionInsertToken(p: Pick<ProfileMention, "character_name" | "discord_username">) {
  const d = p.discord_username?.trim();
  if (d) return d.replace(/\s+/g, "_");
  return p.character_name.trim().replace(/\s+/g, "_");
}

function mentionHandlesForUser(p: Pick<ProfileMention, "character_name" | "discord_username">) {
  const set = new Set<string>();
  const d = p.discord_username?.trim();
  if (d) set.add(d.toLowerCase());
  set.add(p.character_name.trim().replace(/\s+/g, "_").toLowerCase());
  return set;
}

function messageMentionsUser(body: string, my: Pick<ProfileMention, "character_name" | "discord_username">) {
  const handles = mentionHandlesForUser(my);
  const re = /@(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (handles.has(m[1].toLowerCase())) return true;
  }
  return false;
}

function renderMessageBody(body: string) {
  const parts: ReactNode[] = [];
  const re = /@(\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`t${key++}`}>{body.slice(last, m.index)}</span>);
    }
    parts.push(
      <span key={`m${key++}`} className="font-semibold text-[var(--psc-accent)]">
        @{m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) {
    parts.push(<span key={`t${key++}`}>{body.slice(last)}</span>);
  }
  return parts.length > 0 ? parts : body;
}

type ReplyParentRow = { id: string; body: string; author_display: string; user_id: string };

function normalizeParent(
  raw: ReplyParentRow | null | undefined | ReplyParentRow[],
): ReplyParentRow | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

function aggregateReactions(rows: ReactionDbRow[], myId: string): Record<string, EmojiAgg[]> {
  const maps = new Map<string, Map<string, EmojiAgg>>();
  for (const r of rows) {
    let em = maps.get(r.message_id);
    if (!em) {
      em = new Map();
      maps.set(r.message_id, em);
    }
    let a = em.get(r.emoji);
    if (!a) {
      a = { emoji: r.emoji, count: 0, me: false };
      em.set(r.emoji, a);
    }
    a.count += 1;
    if (r.user_id === myId) a.me = true;
  }
  const out: Record<string, EmojiAgg[]> = {};
  for (const [mid, em] of maps) {
    out[mid] = Array.from(em.values()).sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  }
  return out;
}

function mergeReactionInsert(
  prev: Record<string, EmojiAgg[]>,
  row: ReactionDbRow,
  myId: string,
): Record<string, EmojiAgg[]> {
  const next = { ...prev };
  const list = [...(next[row.message_id] ?? [])];
  const i = list.findIndex((x) => x.emoji === row.emoji);
  if (i >= 0) {
    const u = { ...list[i], count: list[i].count + 1, me: list[i].me || row.user_id === myId };
    list[i] = u;
  } else {
    list.push({ emoji: row.emoji, count: 1, me: row.user_id === myId });
  }
  next[row.message_id] = list.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  return next;
}

function mergeReactionDelete(
  prev: Record<string, EmojiAgg[]>,
  row: { message_id: string; user_id: string; emoji: string },
  myId: string,
): Record<string, EmojiAgg[]> {
  const next = { ...prev };
  const list = (next[row.message_id] ?? []).map((x) => ({ ...x }));
  const i = list.findIndex((x) => x.emoji === row.emoji);
  if (i < 0) return prev;
  const deletedMine = row.user_id === myId;
  const u = {
    ...list[i],
    count: list[i].count - 1,
    me: deletedMine ? false : list[i].me,
  };
  if (u.count <= 0) list.splice(i, 1);
  else list[i] = u;
  if (list.length === 0) delete next[row.message_id];
  else next[row.message_id] = list;
  return next;
}

function replySnippet(body: string, max = 100) {
  const t = body.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function WorldChatDock() {
  const [authVersion, setAuthVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [reactions, setReactions] = useState<Record<string, EmojiAgg[]>>({});
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatRow | null>(null);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);
  const [mentionUnread, setMentionUnread] = useState(0);
  const [reactionBusy, setReactionBusy] = useState<string | null>(null);
  const [reactionRefetchNonce, setReactionRefetchNonce] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef(open);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [myProfile, setMyProfile] = useState<ProfileMention | null>(null);

  const [mention, setMention] = useState<{
    start: number;
    query: string;
    results: ProfileMention[];
    highlight: number;
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED") return;
      setAuthVersion((v) => v + 1);
    });
    return () => subscription.unsubscribe();
  }, []);

  const scrollBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const friendlyError = useCallback((msg: string) => {
    if (/relation|does not exist|42P01/i.test(msg)) {
      return "Chat tables are missing or out of date. Apply Supabase migrations for world chat, then refresh.";
    }
    return msg;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let removeChannel: (() => void) | null = null;

    void (async () => {
      let supabase: ReturnType<typeof createClient>;
      try {
        supabase = createClient();
      } catch {
        setLoadError("Chat needs Supabase env keys.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setNoSession(true);
        setMessages([]);
        setReactions({});
        setMentionUnread(0);
        setMyProfile(null);
        setLoadError(null);
        return;
      }
      setNoSession(false);

      const { data: me } = await supabase
        .from("profiles")
        .select("id, character_name, discord_username")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const resolved: ProfileMention =
        (me as ProfileMention | null) ?? {
          id: user.id,
          character_name: "Member",
          discord_username: null,
        };
      setMyProfile(resolved);

      setLoadError(null);
      const { data, error } = await supabase
        .from("world_chat_messages")
        .select(
          `id, user_id, body, author_display, created_at, reply_to_id,
          reply_parent:world_chat_messages!world_chat_messages_reply_to_id_fkey (
            id, body, author_display, user_id
          )`,
        )
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);

      if (cancelled) return;
      if (error) {
        const fallback = await supabase
          .from("world_chat_messages")
          .select("id, user_id, body, author_display, created_at")
          .order("created_at", { ascending: false })
          .limit(FETCH_LIMIT);
        if (fallback.error) {
          setLoadError(friendlyError(error.message || "Could not load chat."));
          return;
        }
        const rowsRaw = (fallback.data ?? []) as Omit<ChatRow, "reply_to_id" | "reply_parent">[];
        const rows: ChatRow[] = rowsRaw.map((r) => ({
          ...r,
          reply_to_id: null,
          reply_parent: null,
        }));
        setMessages(rows.slice().reverse());
        requestAnimationFrame(scrollBottom);
      } else {
        const rowsRaw = (data ?? []) as (Omit<ChatRow, "reply_parent"> & { reply_parent?: ReplyParentRow | ReplyParentRow[] | null })[];
        const rows: ChatRow[] = rowsRaw.map((r) => ({
          ...r,
          reply_to_id: r.reply_to_id ?? null,
          reply_parent: normalizeParent(r.reply_parent),
        }));
        setMessages(rows.slice().reverse());
        requestAnimationFrame(scrollBottom);
      }

      const myId = resolved.id;

      const channel = supabase
        .channel("world_chat_messages_live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "world_chat_messages" },
          (payload) => {
            const raw = payload.new as Record<string, unknown>;
            const row: ChatRow = {
              id: String(raw.id),
              user_id: String(raw.user_id),
              body: String(raw.body),
              author_display: String(raw.author_display ?? "Member"),
              created_at: String(raw.created_at),
              reply_to_id: raw.reply_to_id ? String(raw.reply_to_id) : null,
              reply_parent: null,
            };
            if (!row.id) return;
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              if (row.reply_to_id && !row.reply_parent) {
                const parent = prev.find((m) => m.id === row.reply_to_id);
                if (parent) {
                  row.reply_parent = {
                    id: parent.id,
                    body: parent.body,
                    author_display: parent.author_display,
                    user_id: parent.user_id,
                  };
                }
              }
              const next = [...prev, row];
              return next.length > FETCH_LIMIT ? next.slice(-FETCH_LIMIT) : next;
            });
            if (
              row.user_id !== resolved.id &&
              !openRef.current &&
              messageMentionsUser(row.body, resolved)
            ) {
              setMentionUnread((n) => n + 1);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "world_chat_message_reactions" },
          (payload) => {
            const raw = payload.new as Record<string, unknown>;
            const r: ReactionDbRow = {
              message_id: String(raw.message_id),
              user_id: String(raw.user_id),
              emoji: String(raw.emoji),
            };
            setReactions((prev) => mergeReactionInsert(prev, r, myId));
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "world_chat_message_reactions" },
          (payload) => {
            const raw = payload.old as Record<string, unknown>;
            const mid = raw.message_id != null ? String(raw.message_id) : null;
            const uid = raw.user_id != null ? String(raw.user_id) : null;
            const em = raw.emoji != null ? String(raw.emoji) : null;
            if (mid && uid && em) {
              setReactions((prev) => mergeReactionDelete(prev, { message_id: mid, user_id: uid, emoji: em }, myId));
            } else {
              setReactionRefetchNonce((n) => n + 1);
            }
          },
        )
        .subscribe();

      const rm = () => {
        void supabase.removeChannel(channel);
      };
      if (cancelled) {
        rm();
        return;
      }
      removeChannel = rm;
    })();

    return () => {
      cancelled = true;
      removeChannel?.();
    };
  }, [authVersion, friendlyError, scrollBottom]);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => setMentionUnread(0));
      requestAnimationFrame(scrollBottom);
    }
  }, [messages, open, scrollBottom]);

  useEffect(() => {
    const myId = myProfile?.id;
    if (!myId || messages.length === 0) {
      queueMicrotask(() => setReactions({}));
      return;
    }
    let cancelled = false;
    void (async () => {
      let supabase: ReturnType<typeof createClient>;
      try {
        supabase = createClient();
      } catch {
        return;
      }
      const ids = messages.map((m) => m.id);
      const { data, error } = await supabase
        .from("world_chat_message_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", ids);
      if (cancelled || error) return;
      setReactions(aggregateReactions((data ?? []) as ReactionDbRow[], myId));
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, authVersion, reactionRefetchNonce, myProfile?.id]);

  const fetchMentionRows = useCallback(async (q: string) => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const needle = q.trim();
    if (!needle) {
      setMention((m) => (m ? { ...m, results: [], loading: false } : null));
      return;
    }
    const esc = escapeIlike(needle);
    const pattern = `%${esc}%`;
    const orFilter = `character_name.ilike.${pattern},discord_username.ilike.${pattern}`;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, character_name, discord_username")
      .or(orFilter)
      .order("character_name", { ascending: true })
      .limit(12);
    if (error) return;
    setMention((m) => (m && m.query === q ? { ...m, results: (data ?? []) as ProfileMention[], loading: false } : m));
  }, []);

  const updateMentionFromDraft = useCallback(
    (value: string, cursor: number) => {
      const before = value.slice(0, cursor);
      const at = before.lastIndexOf("@");
      if (at < 0) {
        setMention(null);
        return;
      }
      const afterAt = before.slice(at + 1);
      if (/[\s\n]/.test(afterAt)) {
        setMention(null);
        return;
      }
      if (at > 0 && !/[\s\n]/.test(value[at - 1] ?? "")) {
        setMention(null);
        return;
      }
      setMention((prev) => ({
        start: at,
        query: afterAt,
        results: prev?.query === afterAt ? prev.results : [],
        highlight: 0,
        loading: true,
      }));
      if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
      mentionTimerRef.current = setTimeout(() => {
        void fetchMentionRows(afterAt);
      }, MENTION_DEBOUNCE_MS);
    },
    [fetchMentionRows],
  );

  const applyMention = useCallback(
    (p: ProfileMention) => {
      const el = inputRef.current;
      const token = mentionInsertToken(p);
      const m = mention;
      if (!el || !m) return;
      const start = m.start;
      const end = el.selectionStart ?? draft.length;
      const next = `${draft.slice(0, start)}@${token} ${draft.slice(end)}`;
      setDraft(next.slice(0, MAX_LEN));
      setMention(null);
      requestAnimationFrame(() => {
        const pos = start + 1 + token.length + 1;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [draft, mention],
  );

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || noSession) return;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      setLoadError("Chat needs Supabase env keys.");
      return;
    }
    setSending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSending(false);
      setNoSession(true);
      return;
    }
    const insertPayload: {
      user_id: string;
      body: string;
      reply_to_id?: string | null;
    } = {
      user_id: user.id,
      body: body.slice(0, MAX_LEN),
    };
    if (replyingTo?.id) insertPayload.reply_to_id = replyingTo.id;

    const { error } = await supabase.from("world_chat_messages").insert(insertPayload);
    setSending(false);
    if (error) {
      setLoadError(friendlyError(error.message || "Send failed."));
      return;
    }
    setDraft("");
    setReplyingTo(null);
    setMention(null);
    setLoadError(null);
  };

  const onDraftChange = (value: string) => {
    setDraft(value.slice(0, MAX_LEN));
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? value.length;
    updateMentionFromDraft(value.slice(0, MAX_LEN), cursor);
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mention.results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) =>
          m ? { ...m, highlight: (m.highlight + 1) % m.results.length } : m,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) =>
          m
            ? { ...m, highlight: (m.highlight - 1 + m.results.length) % m.results.length }
            : m,
        );
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const pick = mention.results[mention.highlight];
        if (pick) applyMention(pick);
        return;
      }
      if (e.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const key = `${messageId}:${emoji}`;
    setReactionBusy(key);
    const mine = reactions[messageId]?.find((x) => x.emoji === emoji)?.me;
    try {
      if (mine) {
        const { error } = await supabase
          .from("world_chat_message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", user.id)
          .eq("emoji", emoji);
        if (error) setLoadError(friendlyError(error.message));
      } else {
        const { error } = await supabase.from("world_chat_message_reactions").insert({
          message_id: messageId,
          user_id: user.id,
          emoji,
        });
        if (error) setLoadError(friendlyError(error.message));
      }
    } finally {
      setReactionBusy(null);
    }
  };

  const launcherLabel = useMemo(
    () => (open ? "Hide chamber mail" : "Congressional Chat"),
    [open],
  );

  const myId = myProfile?.id;

  if (noSession) {
    return (
      <div className="fixed bottom-4 left-4 z-[100]">
        <p className="max-w-[14rem] rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-xs text-[var(--psc-muted)] shadow-md">
          Sign in to use Congressional Chat.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-[100] flex flex-col items-start gap-2">
      {open ? (
        <div
          className="flex w-[min(100vw-2rem,26rem)] flex-col overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--psc-ink)_14%,var(--psc-border))] bg-[var(--psc-panel)] shadow-[0_16px_48px_rgba(15,23,42,0.14)]"
          role="dialog"
          aria-label="Congressional Chat"
        >
          <header className="flex items-center justify-between gap-2 border-b border-[var(--psc-border)] bg-gradient-to-b from-[color-mix(in_srgb,var(--psc-ink)_7%,white)] to-[var(--psc-panel)] px-4 py-3">
            <div>
              <p className="font-serif text-[15px] font-semibold tracking-tight text-[var(--psc-ink)]">
                Congressional Chat
              </p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--psc-muted)]">
                Chamber mail · Enter sends · Shift+Enter newline
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-[var(--psc-border)] bg-white/80 px-2.5 py-1 text-xs font-semibold text-[var(--psc-muted)] hover:text-[var(--psc-ink)]"
            >
              Close
            </button>
          </header>
          {loadError ? (
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">{loadError}</p>
          ) : null}
          <div
            ref={listRef}
            className="max-h-[min(52vh,24rem)] space-y-3 overflow-y-auto bg-[linear-gradient(180deg,color-mix(in_srgb,white_92%,var(--psc-canvas)),var(--psc-canvas))] px-3 py-3"
          >
            {messages.length === 0 && !loadError ? (
              <p className="py-10 text-center text-xs leading-relaxed text-[var(--psc-muted)]">
                No messages yet.
                <br />
                <span className="text-[var(--psc-ink)]">@</span> mentions,{" "}
                <span className="text-[var(--psc-ink)]">Reply</span> for threads, quick reactions below each line.
              </p>
            ) : null}
            {messages.map((m) => {
              const parent =
                m.reply_parent ??
                (m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) ?? null : null);
              const rx = reactions[m.id] ?? [];
              const initial = (m.author_display || "?").slice(0, 1).toUpperCase();
              const isSelf = myId && m.user_id === myId;
              return (
                <div
                  key={m.id}
                  className={`group rounded-xl border px-3 py-2.5 shadow-sm transition ${
                    isSelf
                      ? "border-[color-mix(in_srgb,var(--psc-accent)_35%,var(--psc-border))] bg-[color-mix(in_srgb,var(--psc-accent)_8%,white)]"
                      : "border-[color-mix(in_srgb,var(--psc-border)_90%,transparent)] bg-white/95"
                  }`}
                >
                  <div className="flex gap-2.5">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] text-xs font-bold text-[var(--psc-ink)]"
                      aria-hidden
                    >
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                        <p className="text-sm font-semibold text-[var(--psc-ink)]">{m.author_display}</p>
                        <time
                          className="font-mono text-[10px] text-[var(--psc-muted)]"
                          dateTime={m.created_at}
                          suppressHydrationWarning
                        >
                          {new Date(m.created_at).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      {parent ? (
                        <div className="mt-1.5 rounded-md border-l-2 border-[var(--psc-accent)] bg-black/[0.03] py-1 pl-2 pr-1 text-[11px] text-[var(--psc-muted)]">
                          <span className="font-semibold text-[var(--psc-ink)]">{parent.author_display}</span>
                          <span className="mx-1 opacity-60">·</span>
                          <span className="italic">{replySnippet(parent.body)}</span>
                        </div>
                      ) : null}
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-snug text-[var(--psc-ink)]">
                        {renderMessageBody(m.body)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-[var(--psc-border)]/50 pt-2">
                        {QUICK_REACTIONS.map((emoji) => {
                          const agg = rx.find((x) => x.emoji === emoji);
                          const count = agg?.count ?? 0;
                          const active = agg?.me;
                          const busy = reactionBusy === `${m.id}:${emoji}`;
                          return (
                            <button
                              key={emoji}
                              type="button"
                              disabled={busy}
                              onClick={() => void toggleReaction(m.id, emoji)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[13px] transition ${
                                active
                                  ? "border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_14%,white)]"
                                  : "border-transparent bg-black/[0.04] hover:bg-black/[0.07]"
                              } disabled:opacity-50`}
                              title={active ? "Remove reaction" : "React"}
                            >
                              <span>{emoji}</span>
                              {count > 0 ? (
                                <span className="font-mono text-[10px] font-semibold text-[var(--psc-muted)]">
                                  {count}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => {
                            setReplyingTo(m);
                            inputRef.current?.focus();
                          }}
                          className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--psc-accent)] opacity-100 transition hover:underline md:opacity-0 md:group-hover:opacity-100"
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <form
            className="relative border-t border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {replyingTo ? (
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-[var(--psc-border)] bg-white/90 px-2.5 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[var(--psc-accent)]">Replying to {replyingTo.author_display}</p>
                  <p className="mt-0.5 truncate text-[var(--psc-muted)]">{replySnippet(replyingTo.body)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold text-[var(--psc-muted)] hover:bg-black/[0.05] hover:text-[var(--psc-ink)]"
                >
                  Cancel
                </button>
              </div>
            ) : null}
            {mention && (mention.loading || mention.results.length > 0) ? (
              <div
                className="absolute bottom-full left-3 right-3 z-10 mb-1 max-h-44 overflow-y-auto rounded-lg border border-[var(--psc-border)] bg-white py-1 shadow-xl"
                role="listbox"
              >
                {mention.loading && mention.results.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-[var(--psc-muted)]">Searching roster…</p>
                ) : null}
                {mention.results.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={i === mention.highlight}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs ${
                      i === mention.highlight
                        ? "bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)]"
                        : "hover:bg-black/[0.04]"
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyMention(p)}
                  >
                    <span className="font-semibold text-[var(--psc-ink)]">{p.character_name}</span>
                    {p.discord_username ? (
                      <span className="font-mono text-[10px] text-[var(--psc-muted)]">@{p.discord_username}</span>
                    ) : (
                      <span className="text-[10px] text-[var(--psc-muted)]">Underscored IC name</span>
                    )}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={onComposerKeyDown}
                onSelect={(e) => updateMentionFromDraft(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                onClick={(e) => updateMentionFromDraft(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                rows={3}
                maxLength={MAX_LEN}
                placeholder={replyingTo ? "Write a reply…" : "Message the chamber… (@ to mention)"}
                className="min-h-[4.5rem] min-w-0 flex-1 resize-y rounded-lg border border-[color-mix(in_srgb,var(--psc-ink)_10%,var(--psc-border))] bg-white px-3 py-2 text-sm leading-relaxed text-[var(--psc-ink)] outline-none ring-0 focus:border-[var(--psc-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--psc-accent)_25%,transparent)]"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="shrink-0 self-end rounded-lg bg-[var(--psc-accent)] px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm disabled:opacity-40"
              >
                Send
              </button>
            </div>
            <p className="mt-2 text-[10px] text-[var(--psc-muted)]">
              <kbd className="rounded border border-[var(--psc-border)] bg-white px-1 font-mono">Enter</kbd> send ·{" "}
              <kbd className="rounded border border-[var(--psc-border)] bg-white px-1 font-mono">Shift</kbd>+
              <kbd className="rounded border border-[var(--psc-border)] bg-white px-1 font-mono">Enter</kbd> newline ·
              Visible to all signed-in members.
            </p>
          </form>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full border border-[color-mix(in_srgb,var(--psc-ink)_14%,var(--psc-border))] bg-[var(--psc-panel)]/95 px-4 py-2 text-sm font-semibold text-[var(--psc-ink)] shadow-md backdrop-blur-sm hover:bg-white"
        aria-expanded={open}
      >
        {mentionUnread > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white shadow-sm"
            aria-label={`${mentionUnread} new mentions`}
          >
            {mentionUnread > 9 ? "9+" : mentionUnread}
          </span>
        ) : null}
        {launcherLabel}
      </button>
    </div>
  );
}
