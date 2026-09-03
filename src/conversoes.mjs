/**
 * Conversão offline — devolver ao Google Ads e à Meta o que aconteceu DEPOIS
 * do clique.
 *
 * O problema que isto resolve: a plataforma de anúncio só enxerga até o
 * formulário enviado. Ela não sabe se aquele lead virou orçamento, se sumiu ou
 * se comprou oito mil reais. Sem esse retorno, o algoritmo otimiza para volume
 * de formulário — e volume de formulário é exatamente o que uma oficina não
 * quer, porque enche a agenda de curioso e esconde o cliente de frota.
 *
 * Este módulo é PURO: monta o payload e decide se dá para enviar. Quem toca a
 * rede é o despachante, e só depois de o compliance aprovar. Separar as duas
 * coisas é o que permite mostrar numa reunião exatamente o que sairia, sem
 * risco de sair.
 *
 * A disciplina de estado é a mesma do envio de mensagem, pelo mesmo motivo:
 * conversão duplicada não se desfaz. Ela envenena o aprendizado do algoritmo —
 * a plataforma passa a acreditar que aquele perfil converte o dobro, e realoca
 * verba com base numa mentira que nós mesmos contamos.
 */

import { identificadoresHash, podeCorresponder } from './atribuicao.mjs';
import { LOCAIS_CONVERSAO, montarMetaBusinessMessaging, dentroDaJanela } from './ctwa.mjs';

export const DESTINOS = ['google_ads', 'meta_capi'];

/** Eventos que valem devolver. Nem toda mudança de etapa é conversão. */
export const EVENTOS = {
  lead_qualificado: {
    chave: 'lead_qualificado',
    nome: 'Lead qualificado',
    etapas: ['qualificado'],
    nomeMeta: 'Lead',
    // Vale mandar sem valor: o que interessa aqui é o SINAL de qualidade.
    exigeValor: false,
  },
  oportunidade_criada: {
    chave: 'oportunidade_criada',
    nome: 'Orçamento enviado',
    etapas: ['orcamento'],
    nomeMeta: 'InitiateCheckout',
    exigeValor: false,
  },
  venda: {
    chave: 'venda',
    nome: 'Venda fechada',
    etapas: ['ganho'],
    nomeMeta: 'Purchase',
    // Sem valor, uma venda não ensina ROAS — vira só mais um "converteu".
    exigeValor: true,
  },
};

export function eventoDaEtapa(etapa) {
  return Object.values(EVENTOS).find((e) => e.etapas.includes(etapa)) ?? null;
}

/**
 * Formato de data exigido pela Google Ads API: `yyyy-MM-dd HH:mm:ss+|-HH:mm`.
 * Não é ISO-8601. Mandar ISO devolve erro de parse, e o detalhe engana porque
 * "parece" a mesma coisa — muda o `T` por espaço e exige o fuso explícito.
 */
export function dataGoogleAds(iso, minutosFuso = -180) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const deslocado = new Date(d.getTime() + minutosFuso * 60_000);
  const p = (n) => String(n).padStart(2, '0');
  const sinal = minutosFuso >= 0 ? '+' : '-';
  const abs = Math.abs(minutosFuso);

  return `${deslocado.getUTCFullYear()}-${p(deslocado.getUTCMonth() + 1)}-${p(deslocado.getUTCDate())}`
    + ` ${p(deslocado.getUTCHours())}:${p(deslocado.getUTCMinutes())}:${p(deslocado.getUTCSeconds())}`
    + `${sinal}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

/**
 * Decide se a conversão pode ser enviada. Ordem fixa, como no compliance de
 * mensageria: quando mais de um bloqueio se aplica, é a ordem que decide qual
 * motivo fica registrado.
 */
export function avaliarConversao({
  destinoConfigurado, consentimento, atribuicao, hashes, evento, valorCentavos,
  ocorridoEm = null, agoraMs = Date.now(),
}) {
  if (!destinoConfigurado) return negar('destino_nao_configurado');

  // Consentimento vale para conversão offline como vale para mensagem: mandar
  // hash de e-mail de quem não autorizou é tratamento de dado pessoal sem base.
  if (!consentimento) return negar('sem_consentimento');

  const corresp = podeCorresponder(atribuicao ?? {}, hashes ?? {});
  if (!corresp.pode) return negar('sem_identificador');

  const def = EVENTOS[evento];
  if (!def) return negar('evento_desconhecido');
  if (def.exigeValor && !(valorCentavos > 0)) return negar('valor_obrigatorio');

  /*
   * A Conversions API recusa evento com mais de 7 dias.
   *
   * Barrar aqui, e nao descobrir pelo 400 da Meta, importa porque a fila tem
   * retentativa: um evento velho que falha vira tentativa infinita, e o
   * motivo real fica escondido atras de um erro generico de validacao.
   */
  if (ocorridoEm) {
    const j = dentroDaJanela(ocorridoEm, agoraMs);
    if (!j.dentro) return negar(j.motivo === 'data_no_futuro' ? 'data_no_futuro' : 'fora_da_janela');
  }

  return { permitido: true, motivo: null, correspondencia: corresp.porClique ? 'clique' : 'pessoa' };
}

const EXPLICACAO = {
  destino_nao_configurado: 'A empresa não tem esta plataforma configurada.',
  sem_consentimento: 'Sem consentimento LGPD, nenhum identificador sai daqui.',
  sem_identificador: 'Não há parâmetro de clique nem e-mail/telefone para correspondência.',
  evento_desconhecido: 'Evento sem definição de conversão.',
  valor_obrigatorio: 'Venda sem valor não ensina retorno — informe o valor.',
  fora_da_janela: 'A plataforma recusa conversão com mais de 7 dias. Este evento envelheceu na fila.',
  data_no_futuro: 'Data da conversão está no futuro — provável erro de relógio ou de fuso.',
};

function negar(motivo) {
  return { permitido: false, motivo, explicacao: EXPLICACAO[motivo] ?? motivo };
}

/**
 * Payload do Google Ads — Offline Conversion Import (ClickConversion).
 *
 * `partialFailure: true` de propósito: num lote, uma conversão inválida não
 * pode derrubar as outras vinte e nove. A resposta traz os erros por índice.
 */
export function montarGoogleAds({ cliente, atribuicao, evento, valorCentavos, moeda, ocorridoEm, destino, minutosFuso }) {
  const h = identificadoresHash(cliente);
  const identificadores = [];
  if (h.email_sha256) identificadores.push({ hashedEmail: h.email_sha256 });
  if (h.fone_sha256) identificadores.push({ hashedPhoneNumber: h.fone_sha256 });

  const conv = {
    conversionAction: destino?.acao ?? null,
    conversionDateTime: dataGoogleAds(ocorridoEm, minutosFuso),
    conversionValue: Number((valorCentavos / 100).toFixed(2)),
    currencyCode: moeda ?? 'BRL',
    orderId: `${evento}:${cliente.id}`,
  };

  // Um só dos três, na ordem de precisão. Mandar gclid E gbraid juntos é erro
  // de validação na API, não "mais chance de casar".
  if (atribuicao?.gclid) conv.gclid = atribuicao.gclid;
  else if (atribuicao?.wbraid) conv.wbraid = atribuicao.wbraid;
  else if (atribuicao?.gbraid) conv.gbraid = atribuicao.gbraid;

  if (identificadores.length) conv.userIdentifiers = identificadores;

  return {
    endpoint: `customers/${destino?.identificador ?? '<customer_id>'}:uploadClickConversions`,
    corpo: { conversions: [conv], partialFailure: true },
  };
}

/**
 * Payload da Meta Conversions API — `POST /{pixel_id}/events`.
 *
 * `action_source: "system_generated"` é o valor para conversão que nasce de um
 * sistema nosso, não de uma ação do usuário num site. `event_id` é o que
 * permite à Meta desduplicar contra um evento de Pixel do mesmo negócio.
 */
export function montarMetaCapi({
  cliente, atribuicao, evento, valorCentavos, moeda, ocorridoEm, destino, idempotencyKey,
  localConversao = null, urlOrigem = null,
}) {
  /*
   * Conversa aberta por anuncio Click-to-WhatsApp tem rota propria: o
   * identificador e o `ctwa_clid`, nao ha `fbclid` nem navegador, e o payload
   * e outro (`action_source: business_messaging`). Desviar aqui evita mandar
   * um evento web sobre algo que nunca passou por site.
   */
  const local = localConversao ?? (atribuicao?.ctwa_clid ? 'business_messaging' : 'system_generated');
  if (local === 'business_messaging') {
    const bm = montarMetaBusinessMessaging({
      evento,
      ctwaClid: atribuicao?.ctwa_clid,
      wabaId: atribuicao?.waba_id,
      ocorridoEm,
      valorCentavos,
      moeda,
      idempotencyKey,
      leadId: cliente?.id ?? null,
      destino,
    });
    if (!bm.erro) return { endpoint: bm.endpoint, corpo: bm.corpo };
    // Sem `ctwa_clid` ou sem WABA nao da para usar a rota de mensageria.
    // Cair para a rota geral e melhor que nao mandar nada — o evento perde a
    // atribuicao ao clique, mas o telefone hasheado ainda casa o cliente.
  }

  const h = identificadoresHash(cliente);
  const def = EVENTOS[evento];
  const meta = LOCAIS_CONVERSAO[local] ?? LOCAIS_CONVERSAO.website;

  const userData = {};
  if (h.email_sha256) userData.em = [h.email_sha256];
  if (h.fone_digitos_sha256) userData.ph = [h.fone_digitos_sha256];
  if (h.nome_sha256) userData.fn = [h.nome_sha256];
  if (h.sobrenome_sha256) userData.ln = [h.sobrenome_sha256];
  if (h.cidade_sha256) userData.ct = [h.cidade_sha256];
  if (h.pais_sha256) userData.country = [h.pais_sha256];

  /*
   * `fbc` e `fbp` sao cookies de NAVEGADOR, e so existem aqui se uma visita web
   * real os produziu — `extrairAtribuicao` monta o `fbc` a partir de um
   * `fbclid` que veio na URL, nunca do nada. Por isso eles seguem valendo
   * quando a venda fecha por telefone ou na loja: o clique aconteceu de fato.
   *
   * Quem nao os recebe e a rota de mensageria, tratada acima: no
   * Click-to-WhatsApp nao ha navegador nenhum, e preencher esses campos seria
   * inventar jornada.
   */
  if (meta.aceitaFbcFbp) {
    if (atribuicao?.fbc) userData.fbc = atribuicao.fbc;
    if (atribuicao?.fbp) userData.fbp = atribuicao.fbp;
  }

  const dados = {
    event_name: def?.nomeMeta ?? 'Lead',
    event_time: Math.floor(new Date(ocorridoEm).getTime() / 1000),
    action_source: meta.actionSource,
    event_id: idempotencyKey,
    user_data: userData,
  };
  // `event_source_url` e obrigatorio na rota de site e nao deve ser inventado
  // nas outras.
  if (meta.exigeUrl) {
    const url = urlOrigem ?? atribuicao?.pagina_entrada ?? null;
    if (url) dados.event_source_url = url;
  }

  if (valorCentavos > 0) {
    dados.custom_data = { value: Number((valorCentavos / 100).toFixed(2)), currency: moeda ?? 'BRL' };
  }

  return {
    endpoint: `/${destino?.identificador ?? '<pixel_id>'}/events`,
    corpo: { data: [dados] },
  };
}

/**
 * Este estado pode ser repetido sozinho?
 *
 * `desconhecido` fica DE FORA de proposito: a resposta nunca chegou, e a
 * conversao pode ter sido registrada do outro lado. Repetir arrisca contar
 * duas vezes, e numero de conversao inflado vira decisao de verba errada.
 * Ambiguidade exige olho humano — a mesma regra do envio de mensagem.
 */
export function podeRepetirSozinho(status) {
  return status === 'limitado';
}

/** Espera antes da proxima tentativa: exponencial com jitter. */
export function esperaDeRetentativa(tentativa, { baseMs = 5000, tetoMs = 300000 } = {}) {
  const bruto = Math.min(baseMs * (2 ** Math.max(0, tentativa)), tetoMs);
  // Jitter evita que todas as conversoes represadas voltem no mesmo instante e
  // levem um 429 de novo, em coro.
  return Math.round(bruto * (0.5 + Math.random() * 0.5));
}

export function montarPayload(destinoTipo, contexto) {
  // O Google ignora `localConversao` — nao ha campo equivalente no Offline
  // Conversion Import. Ele viaja no contexto assim mesmo para que o servico
  // possa gravar a decisao numa coluna so, valendo para os dois destinos.
  return destinoTipo === 'google_ads' ? montarGoogleAds(contexto) : montarMetaCapi(contexto);
}

/**
 * Classificação da resposta, com o mesmo viés do envio de mensagem: qualquer
 * ambiguidade vira `desconhecido` e NÃO é repetida automaticamente. Uma
 * conversão atrasada custa um dia de aprendizado; uma duplicada custa uma
 * decisão de verba tomada em cima de número inflado.
 */
export function classificarResposta({ status, erro }) {
  if (erro === 'timeout' || erro === 'socket' || (status >= 500 && status <= 599)) return 'desconhecido';
  if (status >= 200 && status < 300) return 'enviado';

  /*
   * 429 e 400 eram tratados igual, e sao opostos.
   *
   * 429 e "voce mandou rapido demais": o evento esta CERTO e a mesma tentativa,
   * mais tarde, funciona. Marcar como falha permanente joga fora uma conversao
   * boa por causa de um pico de trafego.
   *
   * 400 e "o evento esta errado": repetir do jeito que esta produz o mesmo 400
   * para sempre. Precisa de correcao humana no payload — e ai o reenvio usa o
   * MESMO `event_id`, senao a correcao vira duplicata.
   */
  if (status === 429) return 'limitado';
  if (status === 401 || status === 403) return 'sem_permissao';
  return 'falhou';
}

/**
 * Chave de idempotência: uma conversão por evento, por cliente, por destino.
 * Sem a oportunidade no meio de propósito — se o mesmo cliente fecha duas
 * vendas, são dois eventos `venda` com ids de oportunidade diferentes, e é a
 * oportunidade que os separa.
 */
export function chaveIdempotencia({ evento, clienteId, oportunidadeId, destino }) {
  return [destino, evento, clienteId, oportunidadeId ?? 'sem-oportunidade'].join(':');
}
