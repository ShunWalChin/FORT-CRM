# Referência da API

> Gerado a partir de `src/api.mjs`. **67 rotas.**

Todas as rotas devolvem `{ ok, dados }` ou `{ ok: false, erro: { codigo, mensagem } }`.

## Autenticação

`POST /api/sessao` devolve um token. As demais rotas o exigem em
`Authorization: Bearer <token>`, mais o cabeçalho `x-instancia` para dizer de
qual empresa se está falando.

**Identidade é federada pelo e-mail; autorização é por instância.** Cada
instância guarda o próprio vínculo de usuário e é ela quem diz se aquele e-mail
entra. O token carrega o e-mail, nunca um id de usuário — o id difere entre
instâncias.

### As três rotas sem sessão

| Rota | Por que é pública |
|---|---|
| `POST /api/entrada/:chave` | Um formulário de site não faz login. A chave só **roteia**: não lê, não lista, não vira sessão. 20 req/min por origem, corpo limitado a 1 MB, e a resposta é idêntica para chave válida, inválida ou desativada — variar transformaria a porta num oráculo de enumeração. |
| `GET /api/health` | Sonda do contêiner e do balanceador, que não têm sessão. A resposta é deliberadamente pobre — `{ ok, instancias: "3/3" }` e nada mais: sem versão, sem nome de empresa, sem contagem de registro. Abre cada instância e devolve **503** quando nenhuma responde, porque processo de pé com banco ilegível não está saudável. |
| `GET`/`POST /api/whatsapp/webhook` | A Meta não autentica com sessão. O `POST` valida `X-Hub-Signature-256` (HMAC-SHA256 sobre o corpo **bruto**, comparação em tempo constante). Sem `FORTCRM_META_APP_SECRET` a porta fica **fechada**, não aberta. |

### Limites por origem

| Rota | Teto/min |
|---|---|
| `POST /api/demo/reiniciar` | 3 |
| `POST /api/sessao` | 12 — sem teto, vira oráculo de senha por força bruta |
| `POST /api/entrada/…` | 20 — única escrita anônima do sistema |
| Escrita em geral | 60 |
| `POST/PATCH/DELETE /api/vistorias/…` | 240 — são 63 marcações em poucos minutos, mais as fotos. O teto geral de escrita bloqueava o técnico **no meio** do check-list, com o carro no elevador |
| `GET /api/buscar` | 120 — cada tecla pode virar consulta; balde próprio para não comer o orçamento de leitura do resto |
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

## Busca global

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/buscar?q=` | Cliente, veículo, ordem de serviço, pedido, oportunidade e catálogo, **na instância ativa**. |

Termo com menos de 2 caracteres devolve lista vazia com `meta.curto: true` — a
tela precisa distinguir "curto demais" de "não achei".

Cada resultado é `{ tipo, id, titulo, sub, rota, ponto }`. A `rota` é relativa e
consumível pelo roteador do navegador (`clientes?ficha=…`, `ordens?foco=…`).

Nota (`ponto`): **3** igualdade exata, **2** prefixo, **1** contém. A ordenação
final é feita entre os tipos, no servidor — cinco consultas ordenadas
isoladamente nunca produzem a ordem que importa.

Comparação **sem acento dos dois lados**: a coluna passa por `sem_acento()`
(função registrada na conexão) e o termo digitado passa pela mesma normalização
em JS. Telefone é comparado por dígitos; placa, sem traço.

**Não atravessa empresas.** `meta.outras` traz as instâncias a que aquele usuário
tem acesso, para a tela oferecer a travessia — que é explícita e troca a empresa
ativa de verdade. `meta.indisponiveis` lista as consultas que falharam, quando
alguma falha: a busca degrada, mas não em silêncio.

## Campanhas

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/campanhas/resolver` | Busca na Graph API o nome de campanha, conjunto e anúncio dos `source_ad_id` ainda sem nome. **gestor** |

Corpo opcional `{ adIds: [...] }`; sem ele, varre os pendentes (até 25 por
execução). Devolve `{ resolvidos, falhas, pulados, detalhes }`, e
`meta.semToken: true` quando `FORTCRM_META_MARKETING_TOKEN` não está definido —
nesse caso nenhuma chamada externa acontece.

É a única chamada de saída do sistema, e é uma **leitura**: não gasta verba, não
conta conversão, não muda entrega. Por isso não passa por `DEMO_MODE`. Detalhes
em [Campanhas](CAMPANHAS.md).

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

## Credenciais

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/credenciais` | O que está configurado nesta empresa — **nunca o valor**. **gestor** |
| `PUT` | `/api/credenciais/:chave` | Guarda cifrado (AES-256-GCM). **soberano** |
| `DELETE` | `/api/credenciais/:chave` | Apaga; o sistema volta ao piso do ambiente. **soberano** |

A leitura devolve, por credencial: `definida`, `origem`
(`instancia` / `ambiente` / `nenhuma`), `pista` (quatro últimos caracteres),
`atualizadoPor` e `atualizadoEm`. **O valor não sai do servidor** — devolvê-lo
ao navegador o espalharia por cache, histórico e extensão.

`meta.temChaveMestra` diz se `FORTCRM_CHAVE_MESTRA` existe; sem ela o `PUT`
responde **503**, porque guardar segredo em claro não é alternativa.

Detalhes em [Credenciais](CREDENCIAIS.md).

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

## Oficina — veículos e vistoria

> **Só na instância MP.** O menu esconde nas outras; o servidor recusa porque o
> veículo não existe no escopo delas. Detalhes em [Oficina](OFICINA.md).

### Vida do veículo

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/veiculos` | Cadastra e **já cria o plano de manutenção** — em dois passos, o segundo não acontece. |
| `GET` | `/api/veiculos/:id` | Dados, uso, plano projetado, linha do tempo e vistorias, numa resposta só. |
| `POST` | `/api/veiculos/:id/km` | Leitura de hodômetro. Recalcula a média real e reprojeta o plano inteiro. |

A média de km/mês é **calculada** do histórico (`veiculo_km`), nunca digitada.
O hodômetro só anda para a frente, e a recusa traz o número anterior.

Cada serviço do plano vence **por km ou por tempo, o que chegar primeiro**, e a
projeção devolve as duas contas mais qual delas mandou.

### Vistoria de entrada

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/checklist` | O catálogo dos 63 itens. A tela não guarda cópia. |
| `POST` | `/api/vistorias` | Abre com os 63 itens já criados, todos sem estado. |
| `GET` | `/api/vistorias` | Lista, com filtro opcional `?status=`. |
| `GET` | `/api/vistorias/:id` | Vistoria, itens, mídias por item, resumo e **pendências**. |
| `PATCH` | `/api/vistorias/:id/itens/:chave` | Marca um item. A operação mais repetida do app. |
| `POST` | `/api/vistorias/:id/midia` | Binário **cru**. `?item=&tipo=foto\|video&l=&a=`. Teto de 48 MB. |
| `DELETE` | `/api/vistorias/:id/midia/:midiaId` | Só enquanto rascunho: depois do envio a mídia é prova. |
| `POST` | `/api/vistorias/:id/concluir` | Valida e envia. Recusa dizendo **quais** itens faltam. |
| `POST` | `/api/vistorias/:id/aceite` | Aceite ou recusa. Confere o hash antes de gravar. |
| `GET` | `/api/midia/:id` | Serve o arquivo, atrás de sessão. Sai como bytes, não JSON. |
| `POST` | `/api/ordens/:id/iniciar` | **A trava**: recusa sem vistoria aceita, dizendo o que fazer. |

`hashConteudo` resume o que foi aceito. Se algo mudou entre o envio e o aceite,
a vistoria **volta para rascunho** em vez de gravar um aceite que não
corresponde ao documento.

Criar os 63 itens de uma vez, e não conforme se marca, é o que permite perguntar
*"quanto falta"* — e o que garante que a lista não mude no meio do preenchimento
se o catálogo for editado.

## Porta pública de captação

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/entrada/:chave` | exposta a tráfego externo, e nada entra direto na base de produção. |

## Régua de contato

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/regua` | Monta a fila do dia. `dados.fila.adiados` viaja **sempre**, e não só quando a fila esvazia. |
| `POST` | `/api/regua/disparar` | como simulado, e a tela diz isso. |
| `POST` | `/api/regua/adiar` | `{ clienteId, gatilho, dias }`, 1 a 365. Um adiamento vivo por **(cliente, gatilho)** — adiar de novo substitui em vez de empilhar. Auditado. |
| `POST` | `/api/regua/adiar/:id/desfazer` | Devolve o item à fila na próxima montagem. Idempotente: desfazer o que já estava desfeito responde `jaEstava`. |

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
