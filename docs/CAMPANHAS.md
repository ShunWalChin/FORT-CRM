# Nome da campanha por trás do `ad_id`

> O canal em que a empresa gasta dinheiro era o único sem resposta.

## O ponto cego

Um lead de **Click-to-WhatsApp não tem UTM**. Não houve navegador, não houve
página, não houve query string — o anúncio abriu a conversa direto. O que chega
no `referral` do webhook é `source_ad_id` e `ctwa_clid`, e mais nada.

A tela *Origem dos leads* agrupava por `utm_campaign`. Resultado: **todo lead de
Click-to-WhatsApp caía em `sem_campanha`**, e a pergunta que paga o anúncio —
*qual campanha trouxe estas quinze pessoas?* — não tinha resposta justamente
onde há verba.

## Como funciona

`dimensoes_campanha` guarda, por empresa, o que a Graph API respondeu para cada
`ad_id`: nome do anúncio, do conjunto, da campanha e o `effective_status`.

```
POST /api/campanhas/resolver     (gestor)
  → varre os `source_ad_id` sem nome
  → GET https://graph.facebook.com/v21.0/{ad_id}?fields=name,adset{...},campaign{...}
  → grava nome, ou grava o motivo de não ter conseguido
```

`GET /api/atribuicao` **só lê o que já está guardado**, e devolve, por linha, de
onde saiu o nome:

| `fonte_do_nome` | Significa | Conserto |
|---|---|---|
| `utm` | Lead de site; o nome veio da própria URL | — |
| `meta` | CTWA com o `ad_id` já resolvido | — |
| `id_cru` | Veio de anúncio e o nome não foi buscado, ou falhou | Rodar *Resolver nomes* |
| `nenhuma` | Orgânico, indicação, balcão | Não havia campanha |

## As decisões

### Nunca inventar nome

Sem token, sem rede ou com erro da Meta, a tela mostra **o id cru e diz por
quê**. Um `Campanha 120109000000001` fabricado seria pior que o id: parece
resposta.

### Resolver nunca acontece no caminho da tela

Buscar na Graph API durante a renderização deixaria a tela de origem refém da
latência da Meta — e de um token vencido. É a mesma regra já aplicada à
conversão: decidir dentro da transação deixaria a movimentação do funil refém de
uma regra de marketing.

### Ler não é enviar

Resolver nome é uma **leitura** da conta de anúncios da própria empresa: não
gasta verba, não conta conversão, não muda entrega. Por isso não depende de
`DEMO_MODE` — depende de haver `FORTCRM_META_MARKETING_TOKEN`, que só existe
onde alguém configurou de propósito.

O token de leitura é **separado** do token de conversão: este precisa apenas de
`ads_read`, o outro de `manage_events`. Um token único com as duas permissões é
mais cômodo e transforma um vazamento de leitura em permissão de escrita.

### O token vai no cabeçalho

`?access_token=…` — a forma que a documentação da Meta mostra primeiro — acaba
em log de proxy, em histórico e no `Referer`. Há teste que falha se o token
aparecer na URL.

### Falha é guardada, com espera

Um `ad_id` apagado no Gerenciador nunca vai resolver. Sem cache negativo
(`tentado_em`, 6 h), cada clique em *Resolver nomes* o tentaria de novo, e cada
tentativa custa uma chamada contra o limite da conta.

### Falha não apaga o que já estava resolvido

Token vencido não pode transformar seis meses de nomes de campanha em ids crus —
a tela ficaria pior do que antes de o módulo existir. Há teste.

### O erro diz de quem é o problema

`token_invalido` (some para todo mundo ao renovar) e `anuncio_inexistente`
(aquele id sumiu) são consertos diferentes. *"Erro ao resolver"* não distingue.
Rede caída vira `rede`, e não `anuncio_inexistente`: uma queda de minutos não
pode virar "essas campanhas não existem".

### Cache de sete dias

Gente renomeia anúncio no meio da veiculação. Sete dias é o meio-termo entre um
cache que mente e uma conta de API por página aberta.

## Configuração

```bash
# Token de System User com ads_read, no /etc/fortcrm.env (0600 root)
FORTCRM_META_MARKETING_TOKEN=EAA...
```

Sem ele, a tela mostra a faixa dizendo exatamente isto, e continua mostrando o
número do anúncio. Nada quebra.
