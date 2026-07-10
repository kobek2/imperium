-- election_office city values must commit before CHECK constraints reference them (PostgreSQL 55P04).

alter type public.election_office add value if not exists 'mayor';
alter type public.election_office add value if not exists 'council_ward';
