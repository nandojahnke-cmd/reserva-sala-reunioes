# CLAUDE.md

Guia para trabalhar neste repositório.

## O que é

Site de **reserva de sala de reuniões** para uso interno da empresa. Página única,
**estática** (HTML/CSS/JS puro, sem build, sem framework). **Não tem login** — por design,
qualquer pessoa da empresa acessa, cria e cancela reservas. O controle de cancelamento é por
um **código de cancelamento** por reserva (guardado como hash bcrypt no banco).

## Arquivos

- `index.html` — estrutura da página (formulário de reserva, calendário semana/mês, dashboard).
- `styles.css` — estilos.
- `app.js` — toda a lógica: renderização do calendário e chamadas à API REST (`/rest/v1`).
- `config.js` — `window.RESERVA_DB` com `supabaseUrl` e `supabaseKey`.
  ⚠️ Os nomes `supabase*` são **legado**: hoje o backend é **próprio** (ver abaixo), não o Supabase.
  `supabaseUrl` aponta para o próprio domínio e `supabaseKey` é um JWT de role `anon`.
- `supabase-schema.sql` — esquema do banco (tabela, RLS, funções). No self-host, exige criar antes
  os roles `anon`, `authenticated` e `authenticator`.

## Backend (auto-hospedado no VPS)

O backend roda **no próprio VPS** (migrado do Supabase em jun/2026). Mesma tecnologia que o
Supabase usa por baixo, então o `app.js` praticamente não mudou:

- **PostgreSQL** (banco `reservas`) + **PostgREST** (gera a API REST), serviço systemd `postgrest`
  escutando em `127.0.0.1:3000`.
- **nginx** serve o site estático em `/` e faz proxy de `/rest/v1/` → PostgREST (mesmo domínio/HTTPS).
- Segredos (senha do banco, jwt-secret, JWT anon) em `/root/reserva-backend-secrets` (no servidor).

Endpoints que o `app.js` usa:
- **Ler:** `GET /rest/v1/meeting_room_reservations?select=...` — RLS ativo; `anon` só lê colunas não
  sensíveis (nunca o `cancel_code_hash`).
- **Criar:** `POST /rest/v1/rpc/create_meeting_reservation` (função `security definer`). Grava o código
  de cancelamento como **hash bcrypt** (`crypt(code, gen_salt('bf'))`), nunca em texto puro.
- **Cancelar:** `POST /rest/v1/rpc/cancel_meeting_reservation` — só apaga se o código bater com o hash.

Detalhe do schema: há uma **exclusion constraint global** (`no_time_overlap`) — duas reservas não
podem se sobrepor no tempo (modelo de sala única); conflito → erro do banco.

## Implantação e operação (produção)

- Publicado em **https://reserva.hsseminovos.com.br** (cadeado Let's Encrypt, renovação automática).
- **VPS Hostinger** `187.77.192.56` (Ubuntu 24.04). Site em `/var/www/reserva` (clone deste repo).
- DNS no **Registro.br**: registro A `reserva` → `187.77.192.56`.
- **Backup:** `/usr/local/bin/backup-reservas` (pg_dump diário 03:30 via `/etc/cron.d/reservas-backup`)
  → `/var/backups/reservas/` (mantém os últimos 14). Restaurar com `pg_restore`.

### Publicar edições
1. Commit + push para o GitHub (`github.com/felipebertollosperandio/reserva-sala-reunioes`).
2. `ssh root@187.77.192.56 atualizar-reserva` — faz `git pull` + ajusta permissões.

Editar só localmente **não** atualiza o site; precisa passar pelo GitHub + o comando acima.

## ⚠️ Não quebrar (mesmo VPS)

- **market-research** — `/root/market-research`, cron semanal (`0 8 * * 1`). Não usa portas web.
- **fotos-bot** — `fotos-bot.service`, em `/opt/fotos-slack-notion`. Não usa portas web.
- E-mail do domínio é **Microsoft 365**; os registros DNS `MX`/`TXT`/`CNAME` (outlook) não devem ser alterados.

## Validar o backend sem navegador

`curl` contra `https://reserva.hsseminovos.com.br/rest/v1` com a chave de `config.js` em `apikey` +
`Authorization: Bearer`: `GET` para ler, `POST /rpc/create_meeting_reservation` e
`POST /rpc/cancel_meeting_reservation`. Usar horário no futuro distante e cancelar no fim.
