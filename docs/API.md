# Referência da API

> Gerado a partir de `src/api.mjs`. **43 rotas.**

Todas as rotas devolvem `{ ok, dados }` ou `{ ok: false, erro: { codigo, mensagem } }`.

## Autenticação

`POST /api/sessao` devolve um token. As demais rotas o exigem em
`Authorization: Bearer <token>`, mais o cabeçalho `x-instancia` para dizer de
qual empresa se está falando.

**Identidade é federada pelo e-mail; autorização é por instância.** Cada
instância guarda o próprio vínculo de usuário e é ela quem diz se aquele e-mail
entra. O token carrega o e-mail, nunca um id de usuário — o id difere entre
instâncias.

### As duas rotas sem sessão

| Rota | Por que é pública |
|---|---|
| `POST /api/entrada/:chave` | Um formulário de site não faz login. A chave só **roteia**: não lê, não lista, não vira sessão. 20 req/min por origem, corpo limitado a 1 MB, e a resposta é idêntica para chave válida, inválida ou desativada — variar transformaria a porta num oráculo de enumeração. |
| `GET`/`POST /api/whatsapp/webhook` | A Meta não autentica com sessão. O `POST` valida `X-Hub-Signature-256` (HMAC-SHA256 sobre o corpo **bruto**, comparação em tempo constante). Sem `FORTCRM_META_APP_SECRET` a porta fica **fechada**, não aberta. |

### Limites por origem

| Rota | Teto/min |
|---|---|
| `POST /api/demo/reiniciar` | 3 |
| `POST /api/sessao` | 12 — sem teto, vira oráculo de senha por força bruta |
| `POST /api/entrada/…` | 20 — única escrita anônima do sistema |
| Escrita em geral | 60 |
| Leitura | 300 |

## Atribuição

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/atribuicao` | — |

## Auditoria

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/auditoria` | qual instância veio. |
| `GET` | `/api/auditoria/verificar` | — |

## Canais de entrada

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/canais` | tem, mais a chave de captação para colar no site. |

## Catálogo

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/catalogo` | — |

## Central do grupo

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/central/resumo` | — |
| `GET` | `/api/central/leads` | — |
| `POST` | `/api/central/sincronizar` | — |
| `POST` | `/api/central/entrada` | chegada — depois o parâmetro de clique já se perdeu. |

## Clientes

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/clientes` | — |
| `GET` | `/api/clientes/:id` | — |
| `POST` | `/api/clientes` | — |
| `PATCH` | `/api/clientes/:id` | — |
| `POST` | `/api/clientes/:id/opt-out` | — |

## Conversão offline

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/conversoes` | — |
| `POST` | `/api/conversoes/processar` | — |
| `GET` | `/api/conversoes/:id` | — |

## Demonstração

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/demo/reiniciar` | uma rota que apaga a base do cliente, e nenhuma conveniência paga isso. |
| `POST` | `/api/demo/reancorar` | Diferente de recarregar, preserva o que foi feito na demonstração. |
| `GET` | `/api/demo/estado` | — |

## Frota

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/veiculos` | — |
| `PATCH` | `/api/veiculos/:id` | — |

## Gatilhos

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/gatilhos` | — |
| `PATCH` | `/api/gatilhos/:id` | — |

## Histórico

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/disparos` | — |

## Importação

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/importar/clientes` | ele o cliente entra na base como contato histórico, mas fora da régua. |

## Ordens de serviço

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/ordens` | — |
| `POST` | `/api/ordens/:id/concluir` | — |
| `GET` | `/api/ordens/:id/laudo` | — |

## Painéis

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/painel` | — |
| `GET` | `/api/painel/grupo` | exige motivo textual, que fica registrado na auditoria. |

## Pedidos

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/pedidos` | — |

## Pipeline

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/pipeline` | — |
| `PATCH` | `/api/oportunidades/:id` | — |
| `POST` | `/api/oportunidades` | — |

## Porta pública de captação

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/entrada/:chave` | exposta a tráfego externo, e nada entra direto na base de produção. |

## Régua de contato

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/regua` | — |
| `POST` | `/api/regua/disparar` | como simulado, e a tela diz isso. |

## Sessão e senha

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/sessao` | o comportamento correto quando os sistemas são de fato separados. |
| `GET` | `/api/sessao` | — |
| `POST` | `/api/senha` | ar, quem trocou precisa saber que a senha antiga ainda vale lá. |

## Webhook do WhatsApp

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/whatsapp/webhook` | espera o desafio de volta em texto puro — não em JSON. |
| `POST` | `/api/whatsapp/webhook` | continua no banco e pode ser reprocessado. |
