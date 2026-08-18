create extension if not exists vector;

create table if not exists users (
  id varchar(64) primary key,
  username varchar(100) not null unique,
  password_hash varchar(100) not null,
  display_name varchar(200) not null,
  bio varchar(500) not null default '',
  created_at timestamptz not null default now()
);
alter table users add column if not exists bio varchar(500) not null default '';

create table if not exists spaces (
  id varchar(64) primary key,
  owner_id varchar(64) not null references users(id),
  name varchar(200) not null,
  created_at timestamptz not null default now(),
  unique(owner_id, name)
);

create table if not exists archive_folders (
  id varchar(64) primary key,
  space_id varchar(64) not null references spaces(id) on delete cascade,
  parent_id varchar(64) references archive_folders(id) on delete cascade,
  name varchar(200) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists archive_folders_unique_name_idx
  on archive_folders(space_id, coalesce(parent_id, ''), name);

create table if not exists archive_items (
  space_id varchar(64) not null references spaces(id) on delete cascade,
  folder_id varchar(64) references archive_folders(id) on delete set null,
  entity_type varchar(20) not null check (entity_type in ('note', 'document')),
  entity_id varchar(64) not null,
  archived_at timestamptz not null default now(),
  primary key(entity_type, entity_id)
);
create index if not exists archive_items_space_folder_idx on archive_items(space_id, folder_id, archived_at desc);

create table if not exists auth_sessions (
  id varchar(64) primary key,
  user_id varchar(64) not null references users(id),
  access_token_hash char(64) not null unique,
  refresh_token_hash char(64) not null unique,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists documents (
  id varchar(64) primary key,
  space_id varchar(64) not null references spaces(id),
  title varchar(300) not null,
  file_name varchar(512) not null,
  mime_type varchar(150) not null,
  size_bytes bigint not null,
  content text not null,
  content_sha256 char(64) not null,
  status varchar(30) not null,
  tags jsonb not null default '[]'::jsonb,
  source_url text,
  local_path text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table documents add column if not exists local_path text;
alter table documents add column if not exists indexed_at timestamptz;
alter table documents add column if not exists collection varchar(200) not null default '草稿箱';
alter table documents add column if not exists favorite boolean not null default false;
create index if not exists documents_space_updated_idx on documents(space_id, updated_at desc) where deleted_at is null;

create table if not exists notes_v1 (
  id varchar(64) primary key,
  space_id varchar(64) not null references spaces(id),
  title varchar(300) not null,
  content text not null,
  collection varchar(200) not null default '草稿箱',
  favorite boolean not null default false,
  revision bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table notes_v1 add column if not exists collection varchar(200) not null default '草稿箱';
alter table notes_v1 alter column collection set default '草稿箱';
update notes_v1 set collection = '草稿箱' where collection = '收件箱';
create index if not exists notes_v1_space_updated_idx on notes_v1(space_id, updated_at desc) where deleted_at is null;

create table if not exists todos (
  id varchar(64) primary key,
  space_id varchar(64) not null references spaces(id),
  text varchar(500) not null,
  todo_day date not null,
  completed boolean not null default false,
  revision bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists todos_space_day_idx on todos(space_id, todo_day, completed, created_at) where deleted_at is null;

create table if not exists ingestion_jobs (
  id varchar(64) primary key,
  document_id varchar(64) not null references documents(id),
  status varchar(30) not null,
  progress integer not null default 0 check (progress between 0 and 100),
  stage varchar(60),
  error_code varchar(80),
  error_message text,
  updated_at timestamptz not null default now()
);
