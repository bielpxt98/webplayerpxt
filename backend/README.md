# PXT Player no Render

Aplicação Node/Express que serve a API do PXT Player e também os arquivos estáticos do frontend React/Vite gerados em `dist`.

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

## Frontend servido pelo Express

- O build do React/Vite é gerado na pasta `dist` na raiz do repositório.
- O Express serve os assets estáticos dessa pasta.
- Rotas iniciadas por `/api` continuam reservadas para o backend.
- Qualquer outra rota retorna `dist/index.html`, permitindo navegação direta nas telas do frontend.
- O frontend usa a mesma origem por padrão para chamar `/api/xtream/validate`; `VITE_BACKEND_BASE_URL` continua disponível apenas para desenvolvimento ou ambientes separados.

## Regras atuais

- Não baixa `get.php`.
- Não carrega canais, filmes ou séries.
- Não salva dados no Supabase.
- Não retorna a senha na resposta.
- Usa CORS para permitir origens configuradas por variável de ambiente e origens locais de desenvolvimento.

## Como rodar localmente

Instale e gere o frontend na raiz:

```bash
npm install
npm run build
```

Instale e rode o backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

A aplicação ficará disponível em `http://localhost:3001` por padrão.

Exemplo de teste:

```bash
curl http://localhost:3001/health
```

## Variáveis de ambiente

| Variável | Obrigatória | Exemplo | Descrição |
| --- | --- | --- | --- |
| `PORT` | Não | `3001` | Porta local. No Render, ela é injetada automaticamente. |
| `CORS_ORIGIN` | Não | `https://seu-servico.onrender.com` | Origens extras permitidas. Aceita múltiplas origens separadas por vírgula. |
| `FRONTEND_ORIGIN` | Não | `https://seu-servico.onrender.com` | Alias opcional de `CORS_ORIGIN`; também aceita múltiplas origens separadas por vírgula. |
| `VITE_BACKEND_BASE_URL` | Não | `http://localhost:3001` | Base URL alternativa para o frontend em desenvolvimento. Em produção no Render, deixe vazio para usar a mesma origem. |
| `XTREAM_TIMEOUT_MS` | Não | `10000` | Timeout das chamadas para `player_api.php`, em milissegundos. |

## Como publicar no Render

1. Suba este repositório para o GitHub.
2. No Render, crie um novo **Web Service** apontando para o repositório.
3. Deixe **Root Directory** vazio.
4. Use **Runtime** `Node`.
5. Configure **Build Command** como `npm install && npm run build && cd backend && npm install`.
6. Configure **Start Command** como `cd backend && npm start`.
7. Configure variáveis opcionais, se necessário:
   - `CORS_ORIGIN=https://seu-servico.onrender.com`
   - `FRONTEND_ORIGIN=https://seu-servico.onrender.com`
   - `XTREAM_TIMEOUT_MS=10000`
8. Faça o deploy e teste `https://seu-servico.onrender.com/health` e a página inicial do frontend.
