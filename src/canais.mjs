/**
 * Canais de entrada de lead.
 *
 * Antes desta revisão, as três empresas compartilhavam a MESMA lista de
 * origens — a Fazenda Agrofort e a Fort Tintas recebiam lead de `guincho_24h`
 * e de `site_diagnostico`. Fazenda de queijo não recebe lead de guincho, e loja
 * de tinta não faz diagnóstico de bomba injetora. Era a lista da Minas Peças
 * copiada, e ela contamina tudo o que se decide olhando para "origem":
 * qual canal investir, qual gatilho disparar, qual conversão devolver ao
 * Google e à Meta.
 *
 * Cada canal declara:
 *
 *   tipo        como o lead chega FISICAMENTE — é o que decide se dá para
 *               automatizar a entrada;
 *   atribuivel  se o canal carrega parâmetro de clique (gclid/fbclid). Isto é
 *               o divisor de águas da conversão offline: o que não é
 *               atribuível NUNCA vai render conversão importada, por mais
 *               correto que o resto do pipeline esteja;
 *   entrada     por onde o registro nasce no CRM — `webhook` tem porta
 *               pública, `manual` depende de alguém digitar, `integracao`
 *               precisa de conector que ainda não existe.
 *
 * A consequência prática de `atribuivel: false` está em `PERGUNTA_ORIGEM`: em
 * canal presencial ou telefônico, a única atribuição possível é perguntar ao
 * cliente. Sem isso, metade do faturamento fica invisível para o anúncio que
 * o gerou — e o anunciante corta justamente a campanha que funcionava.
 */

export const TIPOS = {
  presencial: { nome: 'Presencial', atribuivel: false },
  telefone: { nome: 'Telefone', atribuivel: false },
  mensagem: { nome: 'Mensagem', atribuivel: false },
  anuncio: { nome: 'Anúncio pago', atribuivel: true },
  formulario: { nome: 'Formulário', atribuivel: true },
  parceiro: { nome: 'Parceiro', atribuivel: false },
  marketplace: { nome: 'Marketplace', atribuivel: false },
  recorrencia: { nome: 'Recorrência', atribuivel: false },
};

const c = (id, nome, tipo, entrada, nota, extra = {}) => ({
  id, nome, tipo, entrada, nota,
  atribuivel: extra.atribuivel ?? TIPOS[tipo].atribuivel,
  ...extra,
});

/* ── Minas Peças — injeção diesel, oficina e balcão de peças ───────────────── */
const MP = [
  c('balcao', 'Balcão da loja', 'presencial', 'manual',
    'Cliente entra com a peça na mão. É o canal de maior volume e o de pior rastreabilidade.'),
  c('telefone', 'Telefone', 'telefone', 'manual',
    'Ligação para a loja. Sem número de origem, não há como ligar à campanha.'),
  c('whatsapp', 'WhatsApp da loja', 'mensagem', 'integracao',
    'Número comercial. Orgânico: quem já conhecia ou pegou o número no Google.'),
  c('whatsapp_anuncio', 'Click-to-WhatsApp (Meta)', 'anuncio', 'webhook',
    'Anúncio que abre a conversa. Traz `ctwa_clid` na primeira mensagem — é o único canal de WhatsApp que fecha o ciclo com a Meta.'),
  c('site_diagnostico', 'Agendar diagnóstico (site)', 'formulario', 'webhook',
    'Formulário do site com veículo e sintoma. Principal fonte atribuível da MP.'),
  c('google_ads_form', 'Formulário do Google Ads', 'anuncio', 'webhook',
    'Lead form da campanha de busca. Chega com gclid e alimenta o Offline Conversion Import.'),
  c('guincho_24h', 'Guincho parceiro 24h', 'parceiro', 'manual',
    'O guincho traz o veículo quebrado. Alta conversão, ticket alto e nenhuma atribuição digital.'),
  c('indicacao_oficina', 'Oficina parceira', 'parceiro', 'manual',
    'Oficina mecânica que não faz injeção e encaminha o serviço.'),
  c('frota_contrato', 'Contrato de frota', 'recorrencia', 'manual',
    'Transportadora com contrato. Entra como recompra, não como lead novo.'),
  c('mercado_livre', 'Mercado Livre', 'marketplace', 'integracao',
    'Venda de peça avulsa. O marketplace retém o dado do comprador.'),
  c('instagram', 'Instagram (perfil e direct)', 'mensagem', 'integracao',
    'Direct e link da bio. Só é atribuível se o link carregar UTM.'),
];

/* ── Fazenda Agrofort — queijo artesanal, B2B e venda direta ───────────────── */
const AF = [
  c('loja_fazenda', 'Loja da fazenda', 'presencial', 'manual',
    'Venda na porteira, para quem sobe a serra. Sazonal e ligada a feriado.'),
  c('whatsapp', 'WhatsApp de pedidos', 'mensagem', 'integracao',
    'O canal principal de queijo artesanal — pedido, foto da peça e combinação de entrega.'),
  c('whatsapp_anuncio', 'Click-to-WhatsApp (Meta)', 'anuncio', 'webhook',
    'Anúncio de queijo premiado que abre conversa. Traz `ctwa_clid`.'),
  c('instagram', 'Instagram', 'mensagem', 'integracao',
    'Onde queijo artesanal de fato vende. Direct e link da bio.'),
  c('site_pedido', 'Pedido pelo site', 'formulario', 'webhook',
    'Formulário com peça, maturação e frete. Atribuível.'),
  c('feira_evento', 'Feira e concurso', 'presencial', 'manual',
    'Feira de queijo e premiação. Gera lista de contatos de uma vez — entra por importação, não um a um.'),
  c('restaurante_parceiro', 'Restaurante e chef', 'parceiro', 'manual',
    'Chef que põe o queijo no cardápio. Volume previsível, ciclo longo.'),
  c('emporio_revenda', 'Empório e mercearia', 'parceiro', 'manual',
    'Revenda física. É cliente B2B recorrente, tratado como conta, não como lead.'),
  c('indicacao', 'Indicação de cliente', 'parceiro', 'manual',
    'Boca a boca. Na venda de queijo é o canal de maior conversão e o menos medido.'),
  c('assinatura', 'Clube de assinatura', 'recorrencia', 'manual',
    'Caixa mensal. A renovação não é lead novo — se contar como lead, infla o funil.'),
];

/* ── Fort Tintas — varejo de tintas, consumidor e pintor ───────────────────── */
const FT = [
  c('balcao', 'Balcão da loja', 'presencial', 'manual',
    'Consumidor que vem escolher cor. Volume alto, ticket baixo.'),
  c('telefone', 'Telefone', 'telefone', 'manual',
    'Consulta de preço e disponibilidade.'),
  c('whatsapp', 'WhatsApp da loja', 'mensagem', 'integracao',
    'Foto da parede e pedido de orçamento. Canal dominante no varejo de tinta.'),
  c('whatsapp_anuncio', 'Click-to-WhatsApp (Meta)', 'anuncio', 'webhook',
    'Anúncio de promoção que abre conversa. Traz `ctwa_clid`.'),
  c('site_orcamento', 'Simulador de orçamento (site)', 'formulario', 'webhook',
    'Metragem e tipo de superfície viram litragem. Atribuível e de alta intenção.'),
  c('google_ads_form', 'Formulário do Google Ads', 'anuncio', 'webhook',
    'Busca por "tinta + cidade". Chega com gclid.'),
  c('instagram', 'Instagram', 'mensagem', 'integracao',
    'Antes e depois de obra. Direct e bio.'),
  c('pintor_parceiro', 'Pintor profissional', 'parceiro', 'manual',
    'O pintor decide a marca e traz o cliente. É o canal mais lucrativo da loja e é invisível no digital.'),
  c('construtora_obra', 'Construtora e obra', 'parceiro', 'manual',
    'Compra por volume, com prazo. Ciclo longo, ticket alto.'),
  c('indicacao', 'Indicação', 'parceiro', 'manual',
    'Vizinho que viu a obra pronta.'),
];

export const CANAIS_POR_EMPRESA = { MP, AF, FT };

/** Canais de uma empresa, ou lista vazia se o código não for conhecido. */
export function canaisDe(codigo) {
  return CANAIS_POR_EMPRESA[String(codigo ?? '').toUpperCase()] ?? [];
}

/** Um canal específico. `null` quando a origem gravada não está no catálogo. */
export function canal(codigo, id) {
  return canaisDe(codigo).find((x) => x.id === id) ?? null;
}

/**
 * Nome legível para uma origem gravada em `clientes.origem`.
 *
 * Nunca inventa: origem fora do catálogo volta como o próprio identificador,
 * marcada como desconhecida. Uma base importada traz origens que ninguém
 * previu, e traduzi-las por adivinhação esconde justamente o que precisa ser
 * arrumado na importação.
 */
export function rotularOrigem(codigo, origem) {
  const achado = canal(codigo, origem);
  if (achado) return { nome: achado.nome, tipo: achado.tipo, atribuivel: achado.atribuivel, conhecido: true };
  return { nome: String(origem ?? 'sem origem'), tipo: null, atribuivel: false, conhecido: false };
}

/**
 * Pergunta a fazer no atendimento quando o canal não é atribuível.
 *
 * Não é enfeite de formulário: em balcão, telefone e indicação é a ÚNICA
 * atribuição possível. Sem ela, a campanha que trouxe o cliente aparece com
 * zero retorno e é a primeira a ser cortada.
 */
export const PERGUNTA_ORIGEM = 'Como você chegou até a gente?';

export const RESPOSTAS_ORIGEM = [
  { id: 'busca_google', nome: 'Procurei no Google' },
  { id: 'anuncio_instagram', nome: 'Vi um anúncio no Instagram ou Facebook' },
  { id: 'indicacao_pessoa', nome: 'Alguém indicou' },
  { id: 'ja_era_cliente', nome: 'Já era cliente' },
  { id: 'passando_frente', nome: 'Passei em frente / vi a placa' },
  { id: 'outro', nome: 'Outro' },
];

/**
 * Diagnóstico de cobertura: quanto da base é atribuível e o que falta ligar.
 * Alimenta a tela "Canais de entrada".
 */
export function diagnosticar(codigo, contagens = {}) {
  const lista = canaisDe(codigo);
  const total = Object.values(contagens).reduce((a, b) => a + b, 0);

  const linhas = lista.map((x) => ({ ...x, leads: contagens[x.id] ?? 0 }));
  const orfaos = Object.entries(contagens)
    .filter(([id]) => !lista.some((x) => x.id === id))
    .map(([id, leads]) => ({ id, nome: id, tipo: null, entrada: null, atribuivel: false, leads, orfao: true }));

  const atribuiveis = linhas.filter((x) => x.atribuivel).reduce((a, x) => a + x.leads, 0);
  const semPorta = linhas.filter((x) => x.entrada === 'webhook' && x.leads === 0);

  return {
    total,
    linhas: [...linhas, ...orfaos],
    orfaos,
    atribuiveis,
    naoAtribuiveis: total - atribuiveis,
    cobertura: total ? Math.round((atribuiveis / total) * 100) : 0,
    semPorta,
  };
}

/**
 * Qual empresa atende um numero de WhatsApp.
 *
 * O webhook diz em qual numero a mensagem caiu (`metadata.display_phone_number`),
 * e e isso que identifica a empresa — cada uma tem o seu. Sem esse roteamento o
 * lead de Click-to-WhatsApp fica parado na triagem da Central esperando alguem
 * decidir de quem ele e, que e exatamente a demora que faz perder a venda.
 *
 * Compara so os digitos: o mesmo numero aparece como `+55 38 99849-3030`,
 * `5538998493030` e `553898493030` conforme quem escreveu.
 */
export function empresaDoNumero(numero, catalogo) {
  const so = (v) => String(v ?? '').replace(/\D/g, '');
  const alvo = so(numero);
  if (!alvo) return null;
  return catalogo.find((e) => {
    const dele = so(e.whatsapp);
    return dele && (dele === alvo || dele.endsWith(alvo) || alvo.endsWith(dele));
  }) ?? null;
}
