/**
 * Click-to-WhatsApp: captura do clique e conversão de volta para a Meta.
 *
 * O sistema já sabia fechar o ciclo de anúncio do Google (gclid) e de anúncio
 * web da Meta (fbclid). Faltava o caso que o catálogo de canais já declarava
 * como atribuível e que o código não tratava: o anúncio que ABRE A CONVERSA no
 * WhatsApp. Ele não tem `fbclid` e não passa por navegador nenhum — o
 * identificador é o `ctwa_clid`, que chega no webhook da primeira mensagem.
 *
 * Três distinções que mudam o que se implementa:
 *
 * 1. **Origem não é local de conversão.** O lead pode nascer no WhatsApp e
 *    comprar no site, por telefone ou na loja. `action_source` descreve ONDE A
 *    CONVERSÃO ACONTECEU, não de onde o lead veio. Rotular tudo como
 *    `business_messaging` porque o lead chegou pelo WhatsApp é reportar
 *    mentira para a plataforma que decide a verba.
 *
 * 2. **`fbc` e `fbp` são do mundo web.** O resto do código monta `fbc` a
 *    partir do `fbclid`, o que é certo para formulário de site. Aqui não
 *    existe clique de navegador, e fabricar esses campos é inventar sinal.
 *
 * 3. **`ctwa_clid` e o ID do WABA NÃO são hasheados.** São identificadores de
 *    clique e de ativo, não dado pessoal. Hashear quebra a correspondência em
 *    silêncio — o evento é aceito e simplesmente não casa com anúncio nenhum.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Onde a conversão aconteceu. É este campo, e não a origem do lead, que a Meta
 * usa para saber que tipo de conversão está recebendo.
 *
 * `aceitaFbcFbp` marca só a rota de mensageria, e a regra é de PROVENIÊNCIA,
 * não de `action_source`: `fbc` e `fbp` valem sempre que tiverem sido
 * capturados numa visita web de verdade, mesmo que a conversão tenha sido
 * decidida depois no CRM ou fechada por telefone — o clique aconteceu, e é ele
 * que a Meta usa para casar. O proibido é FABRICAR o valor onde visita web
 * nenhuma houve, e é exatamente o caso do Click-to-WhatsApp.
 */
export const LOCAIS_CONVERSAO = {
  business_messaging: {
    nome: 'No próprio WhatsApp',
    actionSource: 'business_messaging',
    canalMensageria: 'whatsapp',
    exigeCtwa: true,
    aceitaFbcFbp: false,
  },
  website: {
    nome: 'No site',
    actionSource: 'website',
    canalMensageria: null,
    exigeCtwa: false,
    aceitaFbcFbp: true,
    exigeUrl: true,
  },
  phone_call: {
    nome: 'Por telefone',
    actionSource: 'phone_call',
    canalMensageria: null,
    exigeCtwa: false,
    aceitaFbcFbp: true,
  },
  /*
   * Mudanca de etapa decidida DENTRO do CRM, sem interacao do cliente naquele
   * instante — o operador marcou "qualificado" olhando para a ficha. E o
   * padrao justamente por ser o rotulo que afirma menos: dizer `website` aqui
   * inventaria uma jornada de navegador que ninguem fez.
   */
  system_generated: {
    nome: 'Decidido no CRM',
    actionSource: 'system_generated',
    canalMensageria: null,
    exigeCtwa: false,
    aceitaFbcFbp: true,
  },
  physical_store: {
    nome: 'Na loja',
    actionSource: 'physical_store',
    canalMensageria: null,
    exigeCtwa: false,
    aceitaFbcFbp: true,
  },
};

/**
 * Eventos que a Conversions API for Business Messaging aceita.
 *
 * Lista fechada, e por isso ela existe aqui: `Schedule` e `Opportunity` — que
 * seriam os nomes naturais para "reunião marcada" e "oportunidade criada" —
 * NÃO estão nela. Mandar um nome de fora vira evento customizado, que pode até
 * ser aceito, mas não fica elegível para otimização de campanha CTWA. O
 * caminho correto é `QualifiedLead` com o estágio em `custom_data.funnel_stage`.
 */
export const EVENTOS_BM = new Set([
  'Purchase', 'LeadSubmitted', 'InitiateCheckout', 'AddToCart', 'ViewContent',
  'OrderCreated', 'OrderShipped', 'OrderDelivered', 'OrderCanceled',
  'OrderReturned', 'CartAbandoned', 'QualifiedLead', 'RatingProvided',
  'ReviewProvided',
]);

/**
 * Traduz um evento do funil para o par (nome aceito, estágio) da mensageria.
 *
 * Devolve o estágio separado justamente porque a lista acima é fechada: três
 * etapas diferentes do funil viram `QualifiedLead`, e só o `funnel_stage`
 * distingue uma da outra no relatório.
 */
export function eventoBM(chaveEvento) {
  const mapa = {
    lead_recebido: { nome: 'LeadSubmitted', estagio: 'new_lead' },
    lead_qualificado: { nome: 'QualifiedLead', estagio: 'qualified' },
    reuniao_marcada: { nome: 'QualifiedLead', estagio: 'schedule' },
    oportunidade_criada: { nome: 'QualifiedLead', estagio: 'opportunity' },
    proposta_enviada: { nome: 'InitiateCheckout', estagio: 'proposal' },
    venda: { nome: 'Purchase', estagio: 'purchase' },
  };
  return mapa[chaveEvento] ?? null;
}

/* ── Webhook do WhatsApp ──────────────────────────────────────────────────── */

/**
 * Confere a assinatura `X-Hub-Signature-256`.
 *
 * O HMAC precisa ser calculado sobre o corpo BRUTO, exatamente como chegou.
 * Calcular em cima de `JSON.stringify(objetoJaParseado)` é o erro clássico:
 * ordem de chaves e espaçamento mudam, a assinatura nunca bate, e o sintoma é
 * "o webhook parou de funcionar" sem nada no log dizer por quê.
 *
 * Comparação em tempo constante, porque comparar string com `===` vaza, pelo
 * tempo de resposta, quantos bytes do prefixo estavam certos.
 */
export function validarAssinatura(corpoBruto, cabecalho, appSecret) {
  if (!appSecret) return { valida: false, motivo: 'sem_segredo' };
  if (!cabecalho) return { valida: false, motivo: 'sem_assinatura' };

  const bytes = Buffer.isBuffer(corpoBruto) ? corpoBruto : Buffer.from(String(corpoBruto), 'utf8');
  const esperado = `sha256=${createHmac('sha256', appSecret).update(bytes).digest('hex')}`;

  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(String(cabecalho), 'utf8');
  // `timingSafeEqual` exige o mesmo comprimento; tamanhos diferentes já são
  // recusa, e comparar antes evita a exceção.
  if (a.length !== b.length) return { valida: false, motivo: 'assinatura_invalida' };

  return timingSafeEqual(a, b)
    ? { valida: true, motivo: null }
    : { valida: false, motivo: 'assinatura_invalida' };
}

/** Verificação inicial do endpoint (`GET` com `hub.challenge`). */
export function responderDesafio(params, tokenEsperado) {
  const modo = params?.['hub.mode'];
  const token = params?.['hub.verify_token'];
  const desafio = params?.['hub.challenge'];
  if (modo === 'subscribe' && tokenEsperado && token === tokenEsperado) {
    return { ok: true, corpo: String(desafio ?? '') };
  }
  return { ok: false, corpo: null };
}

/**
 * Achata o webhook em uma linha por mensagem recebida.
 *
 * Percorre `entry → changes → messages` inteiro. Assumir `entry[0].changes[0]`
 * é uma armadilha real: a Meta agrupa notificações, e ler só a primeira
 * descarta mensagens sem nenhum erro aparecer.
 */
export function extrairMensagens(corpo) {
  const saida = [];
  for (const entry of corpo?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'messages') continue;
      const valor = change?.value ?? {};
      for (const msg of valor.messages ?? []) {
        const contato = (valor.contacts ?? []).find((c) => c.wa_id === msg.from)
          ?? (valor.contacts ?? [])[0];
        const ref = msg.referral ?? null;

        saida.push({
          waba_id: entry?.id ?? null,
          phone_number_id: valor.metadata?.phone_number_id ?? null,
          numero_exibicao: valor.metadata?.display_phone_number ?? null,
          wa_id: contato?.wa_id ?? msg.from ?? null,
          nome: contato?.profile?.name ?? null,
          wamid: msg.id ?? null,
          recebido_em: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : null,
          tipo: msg.type ?? null,
          texto: msg.text?.body ?? null,

          // Só existe quando a conversa nasceu de um anúncio.
          de_anuncio: Boolean(ref && ref.source_type === 'ad'),
          ctwa_clid: ref?.ctwa_clid ?? null,
          source_ad_id: ref?.source_id ?? null,
          source_url: ref?.source_url ?? null,
          headline: ref?.headline ?? null,

          /*
           * A ausência é registrada, nunca preenchida.
           *
           * O `ctwa_clid` pode faltar legitimamente — posicionamento em Status
           * do WhatsApp é o caso documentado. Inventar um valor produz evento
           * que a Meta aceita e nunca casa com anúncio nenhum: o pior dos
           * mundos, porque o painel mostra conversão e o anunciante confia.
           */
          sem_ctwa: Boolean(ref && ref.source_type === 'ad' && !ref.ctwa_clid),
        });
      }
    }
  }
  return saida;
}

/* ── Payload da Conversions API for Business Messaging ────────────────────── */

/**
 * Monta o evento de conversão de mensageria.
 *
 * `user_data` aqui é deliberadamente enxuto: o par
 * (`whatsapp_business_account_id`, `ctwa_clid`) é o que faz a correspondência.
 * Empilhar telefone e e-mail hasheados não melhora o casamento nesta rota e só
 * manda dado pessoal a mais para fora — o oposto de minimização.
 */
export function montarMetaBusinessMessaging({
  evento, ctwaClid, wabaId, ocorridoEm, valorCentavos = 0, moeda = 'BRL',
  idempotencyKey, leadId = null, pedidoId = null, destino = null, extras = {},
}) {
  const bm = eventoBM(evento);
  if (!bm) return { erro: 'evento_sem_equivalente_bm', corpo: null };
  if (!ctwaClid) return { erro: 'sem_ctwa_clid', corpo: null };
  if (!wabaId) return { erro: 'sem_waba_id', corpo: null };
  if (!EVENTOS_BM.has(bm.nome)) return { erro: 'evento_fora_da_lista_bm', corpo: null };

  const dados = {
    event_name: bm.nome,
    // Unix em SEGUNDOS, GMT. Milissegundos passam pela validação de tipo e
    // caem milhares de anos no futuro — o evento é descartado em silêncio.
    event_time: Math.floor(new Date(ocorridoEm).getTime() / 1000),
    event_id: idempotencyKey,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: String(wabaId),
      ctwa_clid: String(ctwaClid),
    },
    custom_data: {
      funnel_stage: bm.estagio,
      ...(leadId ? { lead_id: leadId } : {}),
      ...extras,
    },
  };

  if (valorCentavos > 0) {
    dados.custom_data.value = Number((valorCentavos / 100).toFixed(2));
    dados.custom_data.currency = moeda ?? 'BRL';
  }
  if (pedidoId) dados.custom_data.order_id = pedidoId;

  return {
    erro: null,
    endpoint: `/${destino?.identificador ?? '<dataset_id>'}/events`,
    corpo: { data: [dados] },
  };
}

/**
 * Janela de aceitação da Conversions API: eventos com mais de 7 dias são
 * recusados.
 *
 * Barrar aqui, e não descobrir pelo 400 da Meta, importa porque a fila tem
 * retentativa: um evento velho que falha vira tentativa infinita, e o motivo
 * real ("passou da janela") fica escondido atrás de um erro genérico de
 * validação.
 */
export const JANELA_CAPI_MS = 7 * 24 * 60 * 60 * 1000;

export function dentroDaJanela(ocorridoEm, agoraMs = Date.now()) {
  const t = new Date(ocorridoEm).getTime();
  if (Number.isNaN(t)) return { dentro: false, motivo: 'data_invalida' };
  if (t > agoraMs + 60_000) return { dentro: false, motivo: 'data_no_futuro' };
  const idade = agoraMs - t;
  if (idade > JANELA_CAPI_MS) {
    return { dentro: false, motivo: 'fora_da_janela_de_7_dias', idadeHoras: Math.round(idade / 3_600_000) };
  }
  return { dentro: true, motivo: null };
}
