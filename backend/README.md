# PXT Player API

Backend separado em Node/Express para o PXT Player. Ele foi criado para rodar no Render e atender o frontend hospedado no Netlify, começando pela validação de credenciais Xtream sem baixar listas completas de IPTV.

## Endpoints

### `GET /health`

Retorna o status básico do serviço.

```json
{
  "ok": true,
  "service": "pxt-player-api"
}
```

### `POST /api/xtream/validate`

Valida credenciais na API Xtream chamando apenas `player_api.php`.

Corpo da requisição:

```json
{
  "server": "http://ttvp2.live",
  "username": "seu_usuario",
  "password": "sua_senha"
}
```

Resposta com dados básicos, sem expor a senha:

```json
{
  "ok": true,
  "status": "Active",
  "auth": 1,
  "username": "seu_usuario",
  "exp_date": "1735689600",
  "max_connections": "1",
  "active_cons": "0",
  "allowed_output_formats": ["m3u8", "ts"]
}
```

## Regras atuais

- Não baixa `get.php`.
- Não carrega canais, filmes ou séries.
- Não salva dados no Supabase.
- Não retorna a senha na resposta.
- Usa CORS para permitir o frontend do Netlify (`https://stupendous-bombolone-32f796.netlify.app`) e origens locais de desenvolvimento, incluindo preflight `OPTIONS`.

## Como rodar localmente

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

A API ficará disponível em `http://localhost:3001` por padrão.

Exemplo de teste:

```bash
curl http://localhost:3001/health
```

## Variáveis de ambiente

| Variável | Obrigatória | Exemplo | Descrição |
| --- | --- | --- | --- |
| `PORT` | Não | `3001` | Porta local. No Render, ela é injetada automaticamente. |
| `CORS_ORIGIN` | Sim em produção | `https://stupendous-bombolone-32f796.netlify.app` | Origem do frontend no Netlify. Aceita múltiplas origens separadas por vírgula. |
| `FRONTEND_ORIGIN` | Não | `https://stupendous-bombolone-32f796.netlify.app` | Alias opcional de `CORS_ORIGIN`; também aceita múltiplas origens separadas por vírgula. |
| `XTREAM_TIMEOUT_MS` | Não | `10000` | Timeout das chamadas para `player_api.php`, em milissegundos. |

## Como publicar no Render

1. Suba este repositório para o GitHub.
2. No Render, crie um novo **Web Service** apontando para o repositório.
3. Configure o **Root Directory** como `backend`.
4. Use **Runtime** `Node`.
5. Configure o **Build Command** como `npm install`.
6. Configure o **Start Command** como `npm start`.
7. Adicione as variáveis de ambiente:
   - `CORS_ORIGIN=https://stupendous-bombolone-32f796.netlify.app`
   - ou `FRONTEND_ORIGIN=https://stupendous-bombolone-32f796.netlify.app`
   - `XTREAM_TIMEOUT_MS=10000` (opcional)
8. Faça o deploy e teste `https://seu-servico.onrender.com/health`.
