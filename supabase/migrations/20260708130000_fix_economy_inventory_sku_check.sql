-- Allow persuasion/attack inventory SKUs (20260707150000 assumed this constraint was updated).

alter table public.economy_inventory drop constraint if exists economy_inventory_sku_check;
alter table public.economy_inventory
  add constraint economy_inventory_sku_check
  check (sku in ('campaign_ad', 'campaign_ad_persuasion', 'campaign_ad_attack'));
