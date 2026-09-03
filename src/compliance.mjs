/**
 * Motor de elegibilidade de mensageria — porte do módulo do Palantyr para o
 * protótipo, mantendo a ordem das checagens e os nomes de motivo.
 *
 * Duas propriedades o tornam confiável, e as duas foram preservadas aqui:
 *
 * É PURO. Não toca rede nem banco. Recebe um retrato do contato e devolve uma
 * decisão determinística — por isso dá para testar as combinações de janela,
 * cooldown e opt-out sem subir nada.
 *
 * É O ÚNICO CAMINHO. Nenhum disparo sai sem passar por aqui, e a avaliação
 * acontece no instante do envio, nunca no agendamento: uma régua marcada às 14h
 * para sair às 20h pode encontrar um contato que pediu descadastro às 17h.
 *
 * A ORDEM das checagens não é decorativa. Quando dois bloqueios se aplicam ao
 * mesmo contato, a ordem decide qual motivo fica registrado na auditoria.
 */

export const RODAPE_OPT_OUT = 'Responda PARAR';
export const JANELA_PADRAO_MS = 24 * 60 * 60 * 1000;
export const COOLDOWN_PADRAO_MS = 24 * 60 * 60 * 1000;

/**
 * Perfil por canal. Os canais NÃO são equivalentes, e tratá-los como iguais é
 * o erro que gera ou bloqueio indevido ou banimento do número.
 */
export const POLITICAS_CANAL = {
  instagram: {
    tipo: 'instagram',
    janelaImpostaPeloProvedor: true,
    aceitaTemplateForaDaJanela: false,
    maxCaracteres: 1000,
  },
  whatsapp_cloud: {
    tipo: 'whatsapp_cloud',
    janelaImpostaPeloProvedor: true,
    aceitaTemplateForaDaJanela: true,
    maxCaracteres: 4096,
  },
  whatsapp_evolution: {
    // A API aceita qualquer envio. O que pune o excesso não é HTTP 400, é o
    // banimento do número — que chega sem aviso e leva semanas para recuperar.
    // A janela vale como política nossa, não como restrição técnica.
    tipo: 'whatsapp_evolution',
    janelaImpostaPeloProvedor: false,
    aceitaTemplateForaDaJanela: false,
    maxCaracteres: 4096,
  },
  webchat: {
    tipo: 'webchat',
    janelaImpostaPeloProvedor: false,
    aceitaTemplateForaDaJanela: false,
    maxCaracteres: 4096,
  },
};

export const EXPLICACAO_MOTIVO = {
  channel_not_connected: 'Canal desconectado — não há por onde sair.',
  opted_out: 'O contato pediu descadastro. Bloqueio sem exceção.',
  blocklisted_content: 'O corpo final da mensagem contém termo bloqueado.',
  no_inbound_interaction: 'Nunca houve mensagem recebida deste contato.',
  trigger_cooldown: 'Este gatilho já falou com o contato dentro do cooldown.',
  outside_24h: 'Fora da janela de 24 horas aberta pelo contato.',
  template_not_approved: 'Fora da janela e sem template aprovado para este canal.',
  texto_excede_limite: 'A mensagem passa do teto de caracteres do canal.',
  sem_consentimento: 'Sem consentimento LGPD registrado. Não entra em régua.',
};

/**
 * @param {object} e
 * @param {string} e.canalTipo
 * @param {boolean} e.canalConectado
 * @param {string} e.corpo            corpo FINAL, com rodapé já inserido
 * @param {boolean} e.automatizado
 * @param {boolean} e.consentimento
 * @param {string|null} e.optOutEm
 * @param {string|null} e.ultimoInboundEm
 * @param {string|null} e.ultimoDisparoDoGatilhoEm
 * @param {number} e.cooldownMs
 * @param {boolean} e.temTemplateAprovado
 * @param {string[]} e.blocklist
 * @param {number} e.agoraMs
 */
export function avaliarCompliance(e) {
  const politica = POLITICAS_CANAL[e.canalTipo];
  if (!politica) {
    return negar('channel_not_connected');
  }

  // 1. Canal desconectado
  if (!e.canalConectado) return negar('channel_not_connected');

  // 2. Opt-out. Sem exceção, inclusive para envio humano.
  if (e.optOutEm) return negar('opted_out');

  // 3. Consentimento LGPD — regra de operação do projeto: ninguém entra na
  //    régua sem consentimento registrado. Só vale para automação.
  if (e.automatizado && !e.consentimento) return negar('sem_consentimento');

  // 4. Blocklist sobre o corpo FINAL, com rodapé já inserido.
  const corpo = String(e.corpo ?? '').toLowerCase();
  const termo = (e.blocklist ?? []).find((t) => t && corpo.includes(t.toLowerCase()));
  if (termo) return negar('blocklisted_content', { termo });

  // 5. Teto de caracteres do canal.
  if ((e.corpo ?? '').length > politica.maxCaracteres) {
    return negar('texto_excede_limite', { limite: politica.maxCaracteres });
  }

  // 6. Sem inbound conversacional nenhum.
  if (!e.ultimoInboundEm) return negar('no_inbound_interaction');

  // 7. Cooldown por gatilho e contato — só automação.
  if (e.automatizado && e.ultimoDisparoDoGatilhoEm) {
    const desde = e.agoraMs - Date.parse(e.ultimoDisparoDoGatilhoEm);
    if (desde < (e.cooldownMs ?? COOLDOWN_PADRAO_MS)) {
      return negar('trigger_cooldown', { faltamMs: (e.cooldownMs ?? COOLDOWN_PADRAO_MS) - desde });
    }
  }

  // 8. Dentro da janela de 24h aberta pelo contato → liberado.
  const desdeInbound = e.agoraMs - Date.parse(e.ultimoInboundEm);
  if (desdeInbound <= JANELA_PADRAO_MS) {
    return permitir('standard_24h');
  }

  // 9. Fora da janela: só template aprovado, e só onde o canal suporta.
  if (politica.aceitaTemplateForaDaJanela && e.temTemplateAprovado) {
    return permitir('template_outside_window');
  }

  return negar(politica.aceitaTemplateForaDaJanela ? 'template_not_approved' : 'outside_24h');
}

function permitir(politica) {
  return { permitido: true, politica, motivo: null, detalhe: null };
}

function negar(motivo, detalhe = null) {
  return {
    permitido: false,
    politica: 'blocked',
    motivo,
    detalhe,
    explicacao: EXPLICACAO_MOTIVO[motivo] ?? motivo,
  };
}

/** Toda mensagem automática termina com o rodapé de descadastro. */
export function comRodape(corpo) {
  const texto = String(corpo ?? '').trimEnd();
  if (texto.toLowerCase().includes(RODAPE_OPT_OUT.toLowerCase())) return texto;
  return `${texto}\n\n${RODAPE_OPT_OUT} para não receber mais.`;
}

/**
 * Classificação de ambiguidade na resposta da plataforma.
 *
 * Erra DE PROPÓSITO para o lado seguro: timeout, socket cortado e qualquer 5xx
 * viram `unknown`. Errar para "não repetir" custa uma mensagem atrasada; errar
 * para o outro lado custa uma mensagem duplicada num cliente, e isso não se
 * desfaz. `unknown` nunca recebe retry automático — vai para fila humana.
 */
export function classificarResposta({ status, erro }) {
  if (erro === 'timeout' || erro === 'socket' || (status >= 500 && status <= 599)) {
    return 'unknown';
  }
  if (status >= 200 && status < 300) return 'sent';
  return 'failed';
}
