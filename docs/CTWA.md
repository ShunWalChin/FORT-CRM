# Click-to-WhatsApp

> O anúncio que abre a conversa em vez de abrir uma página.

## Click-to-WhatsApp — do clique no anúncio à conversão de volta

O sistema já fechava o ciclo do anúncio do Google (`gclid`) e do anúncio web da
Meta (`fbclid`). Faltava o caso que o catálogo de canais **declarava como
atribuível e que o código não tratava**: o anúncio que abre a conversa no
WhatsApp. Ele não tem `fbclid` e não passa por navegador nenhum — o
identificador é o `ctwa_clid`, e ele chega no webhook da primeira mensagem.

### Três distinções que mudam o que se implementa

**Origem não é local de conversão.** O lead pode nascer no WhatsApp e comprar no
site, por telefone ou na loja. `action_source` descreve onde a **conversão**
aconteceu. Rotular tudo como `business_messaging` porque o lead chegou pelo
WhatsApp é reportar coisa errada para quem decide a verba. `montarMetaCapi`
aceita `localConversao` e o padrão continua sendo `system_generated` — o rótulo
que afirma menos.

**`fbc` e `fbp` são de navegador, mas a regra é de proveniência, não de
`action_source`.** Eles valem sempre que uma visita web real os produziu, mesmo
que a venda feche por telefone: o clique aconteceu. O proibido é *fabricar* onde
visita nenhuma houve — e é exatamente o caso do CTWA. (Eu errei isso primeiro,
cortando `fbc` de toda conversão que não fosse web; um teste existente pegou.)

**`ctwa_clid` e o ID do WABA não são hasheados.** São identificadores de clique e
de ativo, não dado pessoal. Hashear quebra a correspondência em silêncio: o
evento é aceito e simplesmente não casa com anúncio nenhum.

### `Schedule` e `Opportunity` não existem em Business Messaging

São os nomes naturais para "reunião marcada" e "oportunidade criada", e **não
estão na lista aceita**. Mandar assim vira evento customizado, que pode ser
aceito e não fica elegível para otimização de campanha CTWA. `eventoBM()` mapeia
as três etapas para `QualifiedLead` e distingue por `custom_data.funnel_stage` —
sem esse parâmetro elas ficariam indistinguíveis no relatório.

### O webhook

`GET /api/whatsapp/webhook` responde o `hub.challenge` em **texto puro** (JSON
faz a Meta recusar o endpoint). `POST` valida `X-Hub-Signature-256` com HMAC-SHA256
sobre o **corpo bruto** — `lerCorpo` pendura os bytes no `req` porque recalcular
a partir do objeto parseado muda ordem e espaçamento, e a assinatura nunca bate.
Comparação em tempo constante.

**Sem `FORTCRM_META_APP_SECRET` a porta fica fechada, não aberta.** O contrário
funciona em desenvolvimento, vai para produção sem a variável e vira endpoint
público de escrita.

O corpo bruto é gravado **antes** de processar: não existe API para recuperar
histórico de webhook perdido. As mensagens são deduplicadas por `wamid` — a Meta
reenvia o que não recebeu 200, com frequência decrescente por até 7 dias, e sem
chave única cada reenvio viraria um lead novo. Verificado: o mesmo webhook três
vezes produz `novas: 1, 0, 0`.

O lead é roteado pelo **número que recebeu a mensagem** (`empresaDoNumero`), não
deixado na triagem — cada empresa tem o seu, e esperar alguém decidir de quem é o
lead é a demora que perde a venda.

**Ausência de `ctwa_clid` é registrada, nunca preenchida.** Posicionamento em
Status do WhatsApp chega como anúncio e sem o clique. Inventar um valor produz
evento que a Meta aceita e que nunca casa com anúncio — o painel mostraria
conversão e o anunciante confiaria nela.

### Janela de 7 dias

`avaliarConversao` barra evento fora da janela antes de tentar enviar. A fila tem
retentativa: um evento velho que falha na plataforma vira tentativa infinita, e o
motivo real fica escondido atrás de um 400 genérico.

### O que deste desenho não entrou

O documento de referência descreve a orquestração em **n8n**. Aqui não faz
sentido: o FORT-CRM *é* o orquestrador — ele tem o webhook, o banco, a fila de
eventos e o despacho. Introduzir n8n acrescentaria um salto de rede e um segundo
lugar onde o estado existe, para fazer o que já é feito em processo.

Também ficaram de fora, por dependerem de credencial real: o enriquecimento de
campanha pela Marketing API (`GET /{AD_ID}?fields=campaign_id,adset_id`), a
criação do dataset via `POST /{WABA_ID}/dataset`, e o envio de fato — `DEMO_MODE`
segue ligado e nada sai para a Meta.

---
