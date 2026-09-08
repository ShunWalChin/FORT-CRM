/**
 * Carga de demonstração — uma empresa por instância.
 *
 * A mudança em relação ao desenho anterior: `semear` recebe QUAL empresa está
 * sendo semeada e popula apenas ela, porque agora cada uma tem o seu arquivo
 * de banco. O `empresa_id` continua em toda linha — não por hábito, mas porque
 * é a segunda barreira, e porque uma instância pode legitimamente hospedar
 * mais de uma empresa quando o cliente for pequeno demais para pagar duas.
 *
 * Os dados são FICTÍCIOS e gerados relativos à data de hoje, de propósito: a
 * régua precisa ter fila no dia da reunião, e carga com data fixa envelhece e
 * abre uma tela vazia justamente na hora de vender.
 *
 * Nenhum dado das listas de audiência anexas foi usado — são e-mail e telefone
 * de pessoas reais coletados para outra finalidade.
 */

import { Banco, agora, novoId } from './db.mjs';
import { GATILHOS } from './regua.mjs';
import { CATALOGO, metaDe } from './federacao.mjs';
import { canaisDe } from './canais.mjs';
import { garantirCamposSistema } from './propriedades.mjs';
import { extrairAtribuicao, identificadoresHash } from './atribuicao.mjs';
import { hashSenha } from './senha.mjs';
import { PLANO_PADRAO, recalcular as recalcularVeiculo } from './veiculos.mjs';

const DIA = 24 * 60 * 60 * 1000;
const HOJE = Date.now();
const iso = (diasAtras) => new Date(HOJE - diasAtras * DIA).toISOString();

export const EMPRESAS = CATALOGO;

/* ── Minas Peças ────────────────────────────────────────────────────────── */

const CLIENTES_MP = [
  // [nome, telefone, email, cidade, perfil, inboundDias, _, atribuicao]
  ['Antônio Ribeiro Sobrinho', '5538998112233', 'antonio.ribeiro@transrib.com.br', 'Januária', 'frota', 0.3, 40, 'gclid'],
  ['Márcio Aparecido Dias', '5538998445566', 'marcio@diaslogistica.com.br', 'Montes Claros', 'frota', 0.7, 120, 'gclid'],
  ['Geraldo Batista Nunes', '5538999223344', null, 'Januária', 'particular', 5, 200, null],
  ['Sebastião Alves Pereira', '5538998776655', 'tiao.alves@gmail.com', 'São Francisco', 'produtor_rural', 0.5, 320, 'fbclid'],
  ['Maria Aparecida Fonseca', '5538999887766', 'cida.fonseca@gmail.com', 'Januária', 'particular', 0.4, 95, 'organico'],
  ['Fazenda Boa Vista LTDA', '5538998334455', 'compras@fazendaboavista.agr.br', 'Itacarambi', 'produtor_rural', 0.9, 410, 'gclid'],
  ['José Carlos Menezes', '5538999556677', null, 'Manga', 'particular', 22, 260, null],
  ['Transportes Norte Mineiro', '5538998221100', 'operacao@tnmtransportes.com.br', 'Montes Claros', 'frota', 0.2, 60, 'ctwa'],
  ['Divino Souza Lima', '5538999334422', 'divino.lima@hotmail.com', 'Januária', 'particular', 40, 150, null],
  ['Agropecuária Barra Grande', '5538998667788', 'adm@barragrande.agr.br', 'Bonito de Minas', 'produtor_rural', 18, 380, 'organico'],
  ['Rubens Teixeira Campos', '5538999112244', 'rubens.campos@gmail.com', 'Januária', 'particular', 8, 88, null],
  ['Construtora Vale do São Francisco', '5538998553311', 'frota@valedosaofrancisco.com.br', 'Januária', 'frota', 0.6, 45, 'gclid'],
];

const VEICULOS = [
  [0, 'QPX7A21', 'Scania', 'R450', 2019, '13.0 D13', 'common_rail_cp4', 382000, 9200, 62],
  [0, 'RTM4B87', 'Volvo', 'FH 460', 2018, '12.8 D13C', 'common_rail_cp3', 511000, 8800, 74],
  [0, 'PYD9C34', 'Mercedes-Benz', 'Actros 2546', 2020, '12.8 OM471', 'common_rail_cp4', 298000, 7600, 40],
  [1, 'QNS3D56', 'Ford', 'Cargo 1719', 2016, '4.8 Cummins ISF', 'common_rail_cp3', 447000, 6200, 118],
  [1, 'RKA8E12', 'Iveco', 'Tector 240E28', 2017, '5.9 FPT', 'common_rail_cp3', 389000, 5900, 132],
  [2, 'GVT2F45', 'Toyota', 'Hilux SRV', 2015, '2.8 GD-6', 'common_rail_cp4', 214000, 1400, 200],
  [3, 'MFT6G78', 'John Deere', 'Trator 6110J', 2014, '4.5 PowerTech', 'bomba_rotativa', null, 0, 320],
  [4, 'HKS1H90', 'Chevrolet', 'S10 LTZ', 2019, '2.8 Duramax', 'common_rail_cp4', 128000, 1100, 95],
  [5, 'NBR5J23', 'Massey Ferguson', 'MF 7180', 2016, '6.8 AGCO Power', 'bomba_mecanica', null, 0, 410],
  [5, 'QAX3K67', 'Volkswagen', 'Constellation 24.280', 2018, '6.9 MAN D08', 'common_rail_cp3', 356000, 5400, 88],
  [6, 'JLP7L89', 'Fiat', 'Ducato', 2013, '2.3 Multijet', 'common_rail_cp3', 289000, 900, 260],
  [7, 'RCM9M12', 'Scania', 'P360', 2017, '9.3 DC09', 'common_rail_cp3', 604000, 10200, 58],
  [7, 'PDF4N34', 'Volvo', 'VM 270', 2019, '7.2 D8K', 'common_rail_cp4', 267000, 7100, 47],
  [8, 'GTR8O56', 'Ford', 'Ranger XLT', 2016, '3.2 Duratorq', 'common_rail_cp4', 176000, 850, 150],
  [9, 'MKV2P78', 'New Holland', 'T7.245', 2018, '6.7 FPT', 'common_rail_cp3', null, 0, 380],
  [10, 'HQS6Q90', 'Nissan', 'Frontier', 2020, '2.3 Twin Turbo', 'common_rail_cp4', 94000, 1250, 88],
  [11, 'RNB1R23', 'Mercedes-Benz', 'Atego 1719', 2015, '4.8 OM924', 'common_rail_cp3', 421000, 4800, 45],
  [11, 'QWE5S45', 'Volkswagen', 'Delivery 9.170', 2019, '4.8 Cummins', 'common_rail_cp3', 187000, 5100, 52],
];

const CATALOGO_MP = [
  ['MP-INJ-REV', 'Revisão completa de injeção eletrônica', 'Injeção', 'servico', 89000, null],
  ['MP-BIC-LIM', 'Limpeza e teste de bicos injetores', 'Injeção', 'servico', 32000, null],
  ['MP-CR-CP3', 'Reparo de bomba Common Rail CP3', 'Bomba', 'servico', 185000, null],
  ['MP-CR-CP4', 'Reparo de bomba Common Rail CP4', 'Bomba', 'servico', 240000, null],
  ['MP-BOM-MEC', 'Reparo de bomba mecânica em linha', 'Bomba', 'servico', 165000, null],
  ['MP-FIL-DIE', 'Troca de filtro de diesel', 'Manutenção', 'servico', 18000, 180],
  ['MP-DIA-ELE', 'Diagnóstico eletrônico com scanner KTS', 'Diagnóstico', 'servico', 15000, null],
  ['MP-GUI-24H', 'Guincho 24 horas', 'Emergência', 'servico', 45000, null],
  ['MP-PRE-FRO', 'Contrato de preventiva de frota (mensal, por veículo)', 'Frota', 'servico', 28000, 30],
];

const COMPONENTES = [
  ['Bomba injetora Common Rail CP3', 'EPS 815', 1600],
  ['Bicos injetores — jogo de 6', 'EPS 200', 1450],
  ['Bomba injetora Common Rail CP4', 'CRS 845', 1800],
  ['Unidade injetora UIS', 'EPS 617', 1250],
  ['Diagnóstico eletrônico completo', 'KTS 340', null],
  ['Bomba rotativa VE', 'EPS 815', 980],
];

const OPORTUNIDADES_MP = [
  [0, 'Contrato de preventiva — 3 veículos', 'negociacao', 336000, 60, 12],
  [1, 'Reparo CP3 + bicos — Cargo 1719', 'orcamento', 285000, 40, 38],
  [7, 'Preventiva de frota — 2 veículos', 'qualificado', 224000, 30, 6],
  [5, 'Revisão de maquinário pré-safra', 'orcamento', 420000, 45, 96],
  [3, 'Bomba rotativa trator 6110J', 'novo', 165000, 20, 2],
  [11, 'Contrato preventiva construtora', 'ganho', 168000, 100, 20],
  [2, 'Limpeza de bicos Hilux', 'perdido', 32000, 0, 60],
];

/* ── Fazenda Agrofort ───────────────────────────────────────────────────── */

const CLIENTES_AF = [
  ['Luciana Prado Menezes', '5531998112233', 'luciana.prado@gmail.com', 'Belo Horizonte', 'consumidor', 2, 'fbclid'],
  ['Empório Sabor de Minas', '5531998445566', 'compras@emporiosabordeminas.com.br', 'Belo Horizonte', 'revenda', 6, 'gclid'],
  ['Roberto Carvalho Pinto', '5538999223344', 'roberto.pinto@uol.com.br', 'Montes Claros', 'consumidor', 12, null],
  ['Casa do Queijo Norte', '5538998776655', 'contato@casadoqueijonorte.com.br', 'Montes Claros', 'revenda', 3, 'organico'],
  ['Fernanda Lopes Andrade', '5511998887766', 'fernanda.andrade@gmail.com', 'São Paulo', 'consumidor', 40, 'ctwa'],
  ['Adalberto Nunes Rocha', '5538998334455', null, 'Januária', 'consumidor', 90, null],
  ['Mercearia Bom Jesus', '5538999556677', 'merceariabomjesus@gmail.com', 'Januária', 'revenda', 5, null],
  ['Cristiane Moreira Dias', '5521998221100', 'cris.moreira@hotmail.com', 'Rio de Janeiro', 'consumidor', 130, 'ctwa'],
  ['Paulo Henrique Braga', '5538999334422', 'ph.braga@gmail.com', 'Januária', 'consumidor', 8, null],
  ['Delicatessen Serra Mineira', '5531998667788', 'pedidos@serramineira.com.br', 'Nova Lima', 'revenda', 20, 'gclid'],
  ['Vera Lúcia dos Santos', '5538999112244', 'veralucia.santos@bol.com.br', 'Manga', 'consumidor', 170, null],
  ['Marcelo Tavares Lima', '5561998553311', 'marcelo.tavares@gmail.com', 'Brasília', 'consumidor', 15, 'organico'],
  ['Ana Beatriz Souza', '5538998990011', 'anabeatriz.souza@gmail.com', 'Januária', 'consumidor', 4, null],
  ['Empório Terra Boa', '5534998112299', 'compras@terraboa.com.br', 'Uberlândia', 'revenda', 30, 'gclid'],
];

const CATALOGO_AF = [
  ['AF-QMC-500', 'Queijo Minas Artesanal meia cura 500g', 'Queijos', 'produto', 4500, 30],
  ['AF-QMT-800', 'Queijo maturado 60 dias 800g', 'Queijos', 'produto', 8900, 45],
  ['AF-QFL-600', 'Queijo florido (mofo branco) 600g', 'Queijos', 'produto', 9800, 45],
  ['AF-PDQ-400', 'Pão de queijo congelado 400g', 'Derivados', 'produto', 2800, 21],
  ['AF-BIS-300', 'Biscoito de queijo artesanal 300g', 'Derivados', 'produto', 2200, 30],
  ['AF-DOC-400', 'Doce de leite da fazenda 400g', 'Derivados', 'produto', 3200, 45],
  ['AF-CES-PRE', 'Cesta premiada — três queijos medalhistas', 'Cestas', 'produto', 21900, 60],
  ['AF-CAI-REV', 'Caixa revenda — 12 unidades sortidas', 'Revenda', 'produto', 42000, 30],
];

const PEDIDOS_AF = [
  [0, 38, 30, [['AF-QMC-500', 'Queijo meia cura 500g', 2]], 9000],
  [0, 95, 30, [['AF-PDQ-400', 'Pão de queijo 400g', 3]], 8400],
  [1, 52, 30, [['AF-CAI-REV', 'Caixa revenda 12un', 4]], 168000],
  [2, 41, 45, [['AF-QMT-800', 'Queijo maturado 800g', 1]], 8900],
  [3, 61, 30, [['AF-CAI-REV', 'Caixa revenda 12un', 3]], 126000],
  [4, 8, 45, [['AF-CES-PRE', 'Cesta premiada', 1]], 21900],
  [5, 118, 30, [['AF-QMC-500', 'Queijo meia cura 500g', 4]], 18000],
  [6, 26, 30, [['AF-CAI-REV', 'Caixa revenda 12un', 2]], 84000],
  [7, 165, 45, [['AF-QFL-600', 'Queijo florido 600g', 2]], 19600],
  [8, 4, 21, [['AF-PDQ-400', 'Pão de queijo 400g', 2]], 5600],
  [9, 22, 30, [['AF-CAI-REV', 'Caixa revenda 12un', 5]], 210000],
  [10, 195, 45, [['AF-DOC-400', 'Doce de leite 400g', 3]], 9600],
  [12, 3, 30, [['AF-QMC-500', 'Queijo meia cura 500g', 1], ['AF-BIS-300', 'Biscoito de queijo', 2]], 8900],
  [2, 130, 45, [['AF-QMT-800', 'Queijo maturado 800g', 2]], 17800],
  [4, 70, 45, [['AF-QFL-600', 'Queijo florido 600g', 1]], 9800],
];

const OPORTUNIDADES_AF = [
  [1, 'Reposição mensal — Empório Sabor de Minas', 'negociacao', 168000, 70, 8],
  [9, 'Contrato Delicatessen Serra Mineira', 'orcamento', 210000, 50, 34],
  [13, 'Novo ponto — Empório Terra Boa', 'qualificado', 126000, 35, 5],
  [3, 'Cestas de Natal — 40 unidades', 'novo', 876000, 25, 1],
  [6, 'Reposição Mercearia Bom Jesus', 'ganho', 84000, 100, 26],
];

/* ── Fort Tintas ────────────────────────────────────────────────────────── */

const CLIENTES_FT = [
  ['Joaquim Pereira Alencar', '5538998220011', 'joaquim.alencar@gmail.com', 'Januária', 'particular', 0.4, 'gclid'],
  ['Pinturas Silva & Filhos', '5538998330022', 'contato@pinturassilva.com.br', 'Januária', 'revenda', 0.6, 'gclid'],
  ['Construtora Rio Verde', '5538998440033', 'compras@rioverde.eng.br', 'Montes Claros', 'frota', 0.9, 'ctwa'],
  ['Marlene Souza Andrade', '5538999550044', 'marlene.andrade@hotmail.com', 'Januária', 'particular', 3, null],
  ['Edificar Engenharia', '5538998660055', 'suprimentos@edificar.eng.br', 'Januária', 'frota', 0.3, 'gclid'],
  ['Sebastião Ferreira Melo', '5538999770066', null, 'Manga', 'particular', 26, null],
  ['Cores & Cia Decorações', '5538998880077', 'orcamento@coresecia.com.br', 'Montes Claros', 'revenda', 0.7, 'organico'],
  ['Raimundo Nonato Costa', '5538999990088', 'raimundo.costa@gmail.com', 'Itacarambi', 'particular', 12, 'ctwa'],
  ['Condomínio Alto da Serra', '5538998110099', 'sindico@altodaserra.com.br', 'Januária', 'frota', 0.5, null],
  ['Ateliê Reforma Fácil', '5538998221177', 'contato@reformafacil.com.br', 'Januária', 'revenda', 45, 'gclid'],
  ['Cleide Martins Rocha', '5538999332288', 'cleide.rocha@bol.com.br', 'São Francisco', 'particular', 70, null],
  ['Imobiliária Norte Lar', '5538998443399', 'manutencao@nortelar.com.br', 'Januária', 'frota', 8, 'organico'],
];

const CATALOGO_FT = [
  ['FT-ACR-18L', 'Tinta acrílica premium fosca 18L', 'Tintas', 'produto', 38900, 120],
  ['FT-ACR-36L', 'Tinta acrílica standard 3,6L', 'Tintas', 'produto', 8900, 120],
  ['FT-ESM-36L', 'Esmalte sintético brilhante 3,6L', 'Tintas', 'produto', 12400, 180],
  ['FT-TEX-25K', 'Textura acrílica projetada 25kg', 'Texturas', 'produto', 16900, 240],
  ['FT-MAS-18L', 'Massa corrida PVA 18L', 'Preparação', 'produto', 9800, 120],
  ['FT-SEL-18L', 'Selador acrílico 18L', 'Preparação', 'produto', 14500, 150],
  ['FT-IMP-18L', 'Impermeabilizante para laje 18L', 'Impermeabilizantes', 'produto', 32900, 730],
  ['FT-ROL-23', 'Rolo de lã antigota 23cm', 'Acessórios', 'produto', 3900, 60],
  ['FT-PIN-KIT', 'Kit pincéis profissional', 'Acessórios', 'produto', 6700, 90],
  ['FT-TIN-AUT', 'Tinta automotiva poliéster — litro', 'Automotiva', 'produto', 18900, null],
  ['FT-COL-PER', 'Colorimetria personalizada (serviço)', 'Serviços', 'servico', 2500, null],
  ['FT-ENT-OBR', 'Entrega em obra — Januária e região', 'Serviços', 'servico', 4000, null],
];

/** Pedidos da loja: [clienteIdx, diasAtras, cicloDias, itens, valorCentavos] */
const PEDIDOS_FT = [
  [0, 44, 120, [['FT-ACR-18L', 'Acrílica premium 18L', 2], ['FT-ROL-23', 'Rolo antigota', 3]], 89500],
  [1, 18, 60, [['FT-ACR-18L', 'Acrílica premium 18L', 6], ['FT-MAS-18L', 'Massa corrida 18L', 4]], 272600],
  [2, 33, 90, [['FT-TEX-25K', 'Textura projetada', 12], ['FT-SEL-18L', 'Selador 18L', 6]], 289800],
  [3, 130, 120, [['FT-ACR-36L', 'Acrílica 3,6L', 3]], 26700],
  [4, 12, 60, [['FT-IMP-18L', 'Impermeabilizante 18L', 4]], 131600],
  [5, 210, 120, [['FT-ESM-36L', 'Esmalte 3,6L', 2]], 24800],
  [6, 26, 60, [['FT-ACR-18L', 'Acrílica premium 18L', 4]], 155600],
  [7, 96, 120, [['FT-MAS-18L', 'Massa corrida 18L', 2], ['FT-SEL-18L', 'Selador 18L', 1]], 34100],
  [8, 58, 180, [['FT-IMP-18L', 'Impermeabilizante 18L', 6]], 197400],
  [9, 140, 60, [['FT-ACR-18L', 'Acrílica premium 18L', 8]], 311200],
  [10, 250, 120, [['FT-ACR-36L', 'Acrílica 3,6L', 2]], 17800],
  [11, 20, 90, [['FT-ESM-36L', 'Esmalte 3,6L', 5], ['FT-PIN-KIT', 'Kit pincéis', 2]], 75400],
];

const OPORTUNIDADES_FT = [
  [2, 'Fachada Residencial Rio Verde — 3 torres', 'negociacao', 1240000, 65, 9],
  [4, 'Impermeabilização de lajes — Edificar', 'orcamento', 658000, 45, 31],
  [1, 'Contrato mensal Pinturas Silva', 'qualificado', 420000, 40, 4],
  [8, 'Repintura do condomínio Alto da Serra', 'novo', 890000, 20, 2],
  [6, 'Reposição Cores & Cia', 'ganho', 155600, 100, 26],
  [9, 'Ateliê Reforma Fácil — linha completa', 'perdido', 311200, 0, 95],
];

/* ── Utilidades de atribuição ───────────────────────────────────────────── */

/** Gera uma atribuição plausível para o tipo pedido. */
/**
 * Origem do lead, escolhida no catálogo DA EMPRESA e coerente com a atribuição.
 *
 * Duas correções aqui, e as duas mudam o que o sistema conclui:
 *
 * 1. A lista era uma só para as três empresas, com `guincho_24h` e
 *    `site_diagnostico` — canais de oficina de injeção — aparecendo na fazenda
 *    de queijo e na loja de tintas. Origem errada leva a decidir verba errada.
 *
 * 2. Origem e atribuição eram sorteadas de forma independente, e saíam clientes
 *    com `origem: 'balcao'` carregando gclid. Isso é contraditório: quem entrou
 *    pela porta não clicou em anúncio. Quem tem parâmetro de clique só pode ter
 *    vindo por canal atribuível, e é isso que o diagnóstico de cobertura mede.
 */
/** Valores de exemplo para os campos proprios de cada empresa. */
function camposDeExemplo(codigo, i) {
  if (i % 3 === 2) return {};  // um terco sem preencher
  if (codigo === 'MP') {
    return {
      tipo_bomba: ['rotativa', 'mecanica em linha', 'common rail'][i % 3],
      ...(i % 4 === 0 ? { frota_placas: 3 + (i % 9) } : {}),
    };
  }
  if (codigo === 'AF') {
    return {
      maturacao: ['fresco', 'meia cura', 'curado', 'extra curado'][i % 4],
      ...(i % 3 === 0 ? { entrega_dia: ['terca', 'quinta', 'sabado'][i % 3] } : {}),
    };
  }
  if (codigo === 'FT') {
    return {
      tipo_superficie: [['alvenaria'], ['alvenaria', 'externa'], ['madeira', 'gesso']][i % 3],
      ...(i % 2 === 0 ? { metragem: 40 + i * 12 } : {}),
    };
  }
  return {};
}

function origemDe(codigo, tipoAtr, i) {
  const lista = canaisDe(codigo);
  if (!lista.length) return 'balcao';
  // Click-to-WhatsApp tambem e trafego pago — esquecer 'ctwa' aqui mandaria o
  // lead de anuncio para um canal organico, e a origem na ficha ficaria errada.
  const pago = tipoAtr === 'gclid' || tipoAtr === 'fbclid' || tipoAtr === 'ctwa';
  const elegiveis = lista.filter((x) => x.atribuivel === pago);
  const pool = elegiveis.length ? elegiveis : lista;
  return pool[i % pool.length].id;
}

function atribuicaoDe(tipo, i) {
  if (!tipo) return null;
  const campanhas = ['injecao-diesel-januaria', 'revisao-frota', 'queijo-premiado', 'tintas-obra', 'impermeabilizante'];
  const campanha = campanhas[i % campanhas.length];

  if (tipo === 'gclid') {
    return extrairAtribuicao({
      gclid: `Cj0KCQjw${String(i).padStart(3, '0')}demo${Math.random().toString(36).slice(2, 10)}`,
      utm_source: 'google', utm_medium: 'cpc', utm_campaign: campanha,
      utm_term: 'oficina injecao diesel', utm_content: 'anuncio-a',
    }, { paginaEntrada: 'https://exemplo.com.br/orcamento' });
  }
  if (tipo === 'fbclid') {
    return extrairAtribuicao({
      fbclid: `IwAR${String(i).padStart(2, '0')}demo${Math.random().toString(36).slice(2, 12)}`,
      utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: campanha, utm_content: 'criativo-video',
    }, { paginaEntrada: 'https://exemplo.com.br/', fbp: `fb.1.${HOJE - i * 1000}.${1000000 + i}` });
  }
  /*
   * Click-to-WhatsApp: o caso SEM UTM.
   *
   * Nao houve navegador, nao houve pagina, nao houve query string — o anuncio
   * abriu a conversa direto. Sem este tipo na carga, a demonstracao nunca
   * mostrava o ponto cego que a dimensao de campanha existe para fechar: um
   * lead de anuncio que a tela de origem so sabia chamar de "sem_campanha".
   */
  if (tipo === 'ctwa') {
    const atr = extrairAtribuicao({
      ctwa_clid: `ARBxDemo${String(i).padStart(2, '0')}${Math.random().toString(36).slice(2, 14)}`,
    });
    // `source_ad_id` e `waba_id` sao carimbados a parte, como no webhook real:
    // eles nao chegam por URL e por isso nao estao em PARAMS_CLIQUE.
    atr.source_ad_id = `1201${String(900 + (i % 4)).padStart(4, '0')}5566${i % 3}`;
    atr.waba_id = '109988776655443';
    return atr;
  }
  return extrairAtribuicao({
    utm_source: 'google', utm_medium: 'organic', utm_campaign: 'busca-organica',
  }, { paginaEntrada: 'https://exemplo.com.br/' });
}

/* ── Semeadura ──────────────────────────────────────────────────────────── */

const TABELAS_LIMPAVEIS = [
  'conversoes', 'destinos_conversao', 'identificadores_hash', 'atribuicoes', 'event_log',
  'disparos', 'atividades', 'oportunidades', 'pedidos', 'ordens_servico', 'veiculos',
  'catalogo', 'gatilhos', 'propriedades', 'clientes', 'canais', 'memberships',
  'usuarios', 'empresas',
];

/*
 * `empresa` tem padrao 'MP' por compatibilidade com os testes antigos, mas o
 * padrao e uma armadilha: quem chama para RECARREGAR e esquece do parametro
 * grava a Minas Pecas por cima da empresa errada, linha de `empresas`
 * inclusive. Foi o que aconteceu com `recarregarDemo`. Com `reset` ligado o
 * estrago e silencioso e total, entao ai o codigo passa a ser exigido.
 */
export function semear(banco, { empresa = 'MP', reset = false } = {}) {
  if (reset && empresa === 'MP' && arguments[1]?.empresa === undefined) {
    throw new Error(
      'semear com reset exige `empresa` explicita — recarregar sem dizer qual '
      + 'empresa grava a MP por cima da base errada',
    );
  }
  return banco.transacao(() => semearInterno(banco, String(empresa).toUpperCase(), reset));
}

function semearInterno(banco, codigo, reset) {
  const sql = banco.sistema();
  const meta = metaDe(codigo);
  if (!meta) throw new Error(`empresa desconhecida na carga: ${codigo}`);

  if (reset) {
    for (const t of TABELAS_LIMPAVEIS) {
      try { sql.exec(`delete from ${t}`); } catch { /* tabela ausente numa base antiga */ }
    }
  }
  // A checagem é POR EMPRESA, não por banco vazio: uma instância pode
  // legitimamente hospedar mais de uma empresa — cliente pequeno demais para
  // pagar duas, ou consolidação depois de fusão. Guardar por "já tem alguma
  // empresa" impediria isso sem motivo, e quebraria os testes de isolamento
  // lógico, que precisam de dois tenants no mesmo arquivo para ter o que
  // provar.
  if (sql.prepare('select count(*) as n from empresas where codigo = ?').get(codigo).n > 0) {
    return { criado: false, empresa: codigo };
  }

  // ── Empresa ─────────────────────────────────────────────────────────────
  const empresaId = novoId();
  sql.prepare(
    `insert into empresas (id, codigo, nome, segmento, cor, whatsapp, cidade, criado_em)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(empresaId, meta.codigo, meta.nome, meta.segmento, meta.cor, meta.whatsapp, meta.cidade, iso(365));

  const escopo = banco.para(empresaId);

  // ── Usuários ────────────────────────────────────────────────────────────
  // A direção existe em toda instância com o mesmo e-mail: é a mesma pessoa
  // acessando três sistemas. Cada instância guarda o seu vínculo — não há
  // diretório central de identidade nesta fase, e fingir que há seria mentira.
  /*
   * A senha inicial vem do ambiente quando existir.
   *
   * Local, sem variável, nasce `demo` — a credencial documentada, que faz a
   * demonstração abrir sem atrito. Hospedado, o instalador gera uma forte e a
   * injeta aqui: um endereço permanente na internet com senha `demo` é o risco
   * nº 1 do laudo, e depender de alguém lembrar de trocar depois é como esse
   * risco vira incidente.
   */
  const senhaInicial = process.env.FORTCRM_SENHA_INICIAL || 'demo';
  const usuarios = [
    // `root` existe alem da `diretoria` porque sao coisas diferentes: um e o
    // acesso tecnico, o outro e uma pessoa da empresa. Confundir os dois faz
    // ninguem querer revogar o acesso tecnico quando o diretor sai.
    ['Root do sistema', 'root@fortgrupo.com.br', senhaInicial, 'soberano'],
    ['Direção do Grupo', 'diretoria@fortgrupo.com.br', senhaInicial, 'soberano'],
    ['Gerência Comercial', 'comercial@fortgrupo.com.br', senhaInicial, 'gestor'],
    // Somente leitura: ve o que o balcao ve e nao grava nada. Serve para
    // contador, auditor externo e para quem esta aprendendo o sistema.
    ['Consulta (somente leitura)', 'consulta@fortgrupo.com.br', senhaInicial, 'leitura'],
    [`Atendimento ${meta.nome}`, operadorDe(codigo), senhaInicial, 'operador'],
  ];
  for (const [nome, email, senha, papel] of usuarios) {
    // Numa instância que hospeda mais de uma empresa, a direção já existe —
    // é a mesma pessoa. O usuário é reaproveitado e ganha mais um vínculo,
    // em vez de virar um segundo cadastro com o mesmo e-mail.
    const existente = sql.prepare('select id from usuarios where lower(email) = ?')
      .get(email.toLowerCase());
    const id = existente?.id ?? novoId();

    if (!existente) {
      // Nasce em hash. Guardar em claro "porque é demonstração" é como o
      // sistema chega em produção com senha em claro — ninguém volta para
      // trocar depois.
      sql.prepare('insert into usuarios (id, nome, email, senha, papel, criado_em) values (?,?,?,?,?,?)')
        .run(id, nome, email, hashSenha(senha), papel, iso(365));
    }
    sql.prepare('insert or ignore into memberships (usuario_id, empresa_id, papel) values (?,?,?)')
      .run(id, empresaId, papel);
  }

  // ── Canais ──────────────────────────────────────────────────────────────
  const canais = {
    MP: [['whatsapp_evolution', 'WhatsApp da oficina', meta.whatsapp, 1], ['instagram', '@minaspecas', null, 1]],
    AF: [['whatsapp_cloud', 'WhatsApp oficial Agrofort', meta.whatsapp, 1], ['instagram', '@fazendagrofort', null, 0]],
    FT: [['whatsapp_cloud', 'WhatsApp Fort Tintas', meta.whatsapp, 1], ['instagram', '@forttintas', null, 1]],
  }[codigo] ?? [];
  for (const [tipo, nome, numero, conectado] of canais) {
    escopo.inserir('canais', { id: novoId(), tipo, nome, numero, conectado, criado_em: iso(300) });
  }

  // ── Gatilhos da régua ───────────────────────────────────────────────────
  for (const [chave, g] of Object.entries(GATILHOS)) {
    if (g.empresa !== codigo) continue;
    escopo.inserir('gatilhos', {
      id: novoId(), chave, nome: g.nome, descricao: g.descricao, regra: g.regra,
      antecedencia_dias: g.antecedencia_dias, cooldown_dias: g.cooldown_dias,
      template: g.template, ativo: 1,
    });
  }

  // ── Destinos de conversão ───────────────────────────────────────────────
  // Identificadores fictícios: o formato é real, o valor não. Trocar por um
  // real é configuração, não código.
  escopo.inserir('destinos_conversao', {
    id: novoId(), destino: 'google_ads', identificador: `${codigo.toLowerCase()}-000-000-0000`,
    acao: `customers/0000000000/conversionActions/${100000 + codigo.charCodeAt(0)}`,
    ativo: 1, criado_em: iso(200),
  });
  escopo.inserir('destinos_conversao', {
    id: novoId(), destino: 'meta_capi', identificador: `pixel_${codigo.toLowerCase()}_000000000`,
    acao: null, ativo: 1, criado_em: iso(200),
  });

  // ── Catálogo ────────────────────────────────────────────────────────────
  const catalogo = { MP: CATALOGO_MP, AF: CATALOGO_AF, FT: CATALOGO_FT }[codigo] ?? [];
  for (const [sku, nome, categoria, tipo, preco, ciclo] of catalogo) {
    escopo.inserir('catalogo', {
      id: novoId(), sku, nome, categoria, tipo, preco_centavos: preco,
      ciclo_recompra_dias: ciclo, ativo: 1,
    });
  }

  // ── Propriedades ────────────────────────────────────────────────────────
  // Os campos de sistema descrevem as colunas reais; os personalizados sao o
  // que cada negocio precisa e os outros dois nao. Uma oficina de injecao nao
  // tem "maturacao preferida", e uma fazenda de queijo nao tem "tipo de bomba".
  garantirCamposSistema(escopo);

  const PROPRIAS = {
    MP: [
      { chave: 'tipo_bomba', rotulo: 'Tipo de bomba', tipo: 'selecao',
        opcoes: ['rotativa', 'mecanica em linha', 'common rail', 'nao sei'],
        mostrar_na_tabela: 1, ordem: 110 },
      { chave: 'frota_placas', rotulo: 'Quantidade de veiculos', tipo: 'numero', ordem: 120 },
    ],
    AF: [
      { chave: 'maturacao', rotulo: 'Maturacao preferida', tipo: 'selecao',
        opcoes: ['fresco', 'meia cura', 'curado', 'extra curado'],
        mostrar_na_tabela: 1, ordem: 110 },
      { chave: 'entrega_dia', rotulo: 'Melhor dia de entrega', tipo: 'selecao',
        opcoes: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'], ordem: 120 },
    ],
    FT: [
      { chave: 'tipo_superficie', rotulo: 'Superficie da obra', tipo: 'multi_selecao',
        opcoes: ['alvenaria', 'madeira', 'metal', 'gesso', 'externa'], ordem: 110 },
      { chave: 'metragem', rotulo: 'Metragem da obra (m2)', tipo: 'numero',
        mostrar_na_tabela: 1, ordem: 120 },
    ],
  }[codigo] ?? [];

  for (const c of PROPRIAS) {
    escopo.inserir('propriedades', {
      id: novoId(), entidade: 'cliente', origem: 'custom',
      chave: c.chave, rotulo: c.rotulo, tipo: c.tipo,
      opcoes: c.opcoes ? JSON.stringify(c.opcoes) : null,
      obrigatorio: 0, mostrar_na_tabela: c.mostrar_na_tabela ?? 0,
      ordem: c.ordem, criado_em: agora(),
    });
  }

  // ── Clientes ────────────────────────────────────────────────────────────
  const brutos = { MP: CLIENTES_MP, AF: CLIENTES_AF, FT: CLIENTES_FT }[codigo] ?? [];
  const ids = [];

  brutos.forEach((linha, i) => {
    const [nome, tel, email, cidade, perfil] = linha;
    const inboundDias = linha[5];
    // O tipo de atribuição é sempre o ÚLTIMO campo. Ler por índice fixo
    // quebrou: as linhas da oficina têm uma coluna a mais que as das outras
    // duas, e a Fort Tintas inteira ficou sem atribuição — sem erro nenhum,
    // só um `undefined` silencioso que virou "22 leads sem origem" no
    // consolidado. Posição relativa ao fim é a leitura que não depende disso.
    const tipoAtr = linha.at(-1);

    const id = novoId();
    ids.push(id);

    // Dois sem consentimento e um com descadastro em cada empresa: a
    // demonstração precisa mostrar o compliance bloqueando, não só o caminho
    // feliz.
    const semConsentimento = i === 6 || i === 10;
    const optOut = i === 8 && codigo !== 'AF';

    escopo.inserir('clientes', {
      id, nome, telefone: tel, email, cidade,
      uf: ufDe(cidade), perfil,
      // CPF/CNPJ so digitos, como o schema pede. Numeros de demonstracao,
      // gerados do indice — nenhum documento real entra na carga.
      cpf: String(10000000000 + i * 37121899).slice(0, 11),
      origem: origemDe(codigo, tipoAtr, i),
      consentimento_lgpd: semConsentimento ? 0 : 1,
      consentimento_em: semConsentimento ? null : iso(300 - i * 5),
      opt_out_em: optOut ? iso(30) : null,
      ultimo_inbound_em: iso(inboundDias),
      observacao: perfil === 'revenda' ? 'Revenda — ticket maior, funil separado.' : null,
      // Campos proprios preenchidos em parte da base, de proposito: campo
      // personalizado quase sempre chega incompleto no mundo real, e a tela
      // precisa mostrar bem o "—".
      campos: JSON.stringify(camposDeExemplo(codigo, i)),
      criado_em: iso(320 - i * 4),
    });

    // Atribuição de primeiro toque + identificadores em hash.
    const atr = atribuicaoDe(tipoAtr, i);
    if (atr) {
      escopo.inserir('atribuicoes', {
        id: novoId(), cliente_id: id, toque: 'primeiro', plataforma: atr.plataforma,
        gclid: atr.gclid, gbraid: atr.gbraid, wbraid: atr.wbraid,
        fbclid: atr.fbclid, fbp: atr.fbp, fbc: atr.fbc,
        // `?? null` obrigatorio: node:sqlite recusa `undefined` como parametro,
        // e so o tipo 'ctwa' preenche estes tres.
        ctwa_clid: atr.ctwa_clid ?? null,
        waba_id: atr.waba_id ?? null,
        source_ad_id: atr.source_ad_id ?? null,
        utm_source: atr.utm_source, utm_medium: atr.utm_medium, utm_campaign: atr.utm_campaign,
        utm_term: atr.utm_term, utm_content: atr.utm_content,
        pagina_entrada: atr.pagina_entrada, referrer: atr.referrer,
        bruto: JSON.stringify(atr.bruto), capturado_em: iso(320 - i * 4),
      });
    }
    const h = identificadoresHash({ nome, email, telefone: tel, cidade });
    escopo.inserir('identificadores_hash', {
      cliente_id: id, email_sha256: h.email_sha256, fone_sha256: h.fone_sha256,
      fone_digitos_sha256: h.fone_digitos_sha256,
      nome_sha256: h.nome_sha256, sobrenome_sha256: h.sobrenome_sha256,
      cidade_sha256: h.cidade_sha256, atualizado_em: agora(),
    });
  });

  // ── Específico da oficina: veículos e ordens de serviço ──────────────────
  if (codigo === 'MP') {
    const veiculoIds = [];
    VEICULOS.forEach(([ci, placa, marca, modelo, ano, motor, sistema, km, media, visitaDias]) => {
      const id = novoId();
      veiculoIds.push(id);
      escopo.inserir('veiculos', {
        id, cliente_id: ids[ci], placa, marca, modelo, ano, motorizacao: motor,
        sistema_injecao: sistema, km_ultima: km,
        horimetro: km === null ? 3200 + ci * 180 : null,
        media_km_mes: media, ultima_visita_em: iso(visitaDias), criado_em: iso(visitaDias + 200),
        chassi: `9BV${String(100000 + ci * 7919).slice(0, 6)}${placa.slice(0, 3)}${1000 + ci}`,
        renavam: String(1000000000 + ci * 8461),
        cor: ['Branco', 'Prata', 'Vermelho', 'Azul', 'Cinza'][ci % 5],
        combustivel: 'diesel_s10',
        ativo: 1,
      });

      /*
       * Historico de hodometro, e nao so o numero de hoje.
       *
       * Sem duas leituras nao ha media, e sem media nao ha previsao — a tela de
       * vida do veiculo abriria dizendo "faltam leituras" na demonstracao
       * inteira, que e justamente o que ela existe para nao dizer.
       *
       * Quatro leituras espalhadas pelo ultimo ano, andando para tras a partir
       * do km atual na media declarada do veiculo.
       */
      if (km !== null && media > 0) {
        [0, 4, 8, 13].forEach((mesesAtras, n) => {
          escopo.inserir('veiculo_km', {
            id: novoId(),
            veiculo_id: id,
            km: Math.max(0, km - Math.round(media * mesesAtras)),
            medido_em: iso(visitaDias + Math.round(mesesAtras * 30.44)),
            origem: n === 0 ? 'ordem_servico' : 'manual',
            origem_id: null,
            criado_por: 'carga',
            criado_em: iso(visitaDias + Math.round(mesesAtras * 30.44)),
          });
        });
      }

      // O plano de manutencao nasce com o veiculo: sem ele o caminhao nao
      // aparece em previsao nenhuma.
      PLANO_PADRAO.forEach((sv, n) => {
        // Cada servico com um "ultimo" diferente, para o plano vencer escalonado
        // em vez de tudo no mesmo dia.
        const feitoHa = 40 + n * 55;
        escopo.inserir('planos_manutencao', {
          id: novoId(),
          veiculo_id: id,
          servico_chave: sv.chave,
          servico_nome: sv.nome,
          intervalo_km: sv.km,
          intervalo_meses: sv.meses,
          ultimo_km: km !== null ? Math.max(0, km - Math.round((media || 1500) * (feitoHa / 30.44))) : null,
          ultimo_em: iso(feitoHa),
          proximo_km: null,
          previsto_em: null,
          ativo: 1,
          criado_em: iso(visitaDias + 200),
          atualizado_em: iso(visitaDias),
        });
      });
    });

    /*
     * Projeta o plano de todos, agora que ha historico.
     *
     * Feito aqui e nao no laco de cima porque `recalcular` le as leituras do
     * banco — e no laco elas ainda nao terminaram de entrar.
     */
    veiculoIds.forEach((vid) => {
      try { recalcularVeiculo(escopo, vid); } catch { /* veiculo sem km fica sem previsao */ }
    });

    VEICULOS.forEach(([ci], vi) => {
      const [componente, bancada, pressao] = COMPONENTES[vi % COMPONENTES.length];
      const dias = [3, 5, 28, 96, 150, 8, 200, 62, 340, 40, 260, 6, 47, 155, 380, 90, 45, 52][vi] ?? 60;
      escopo.inserir('ordens_servico', {
        id: novoId(), cliente_id: ids[ci], veiculo_id: veiculoIds[vi],
        numero: `OS-${String(2400 + vi).padStart(5, '0')}`,
        componente, bancada, pressao_bar: pressao,
        resultado_laudo: pressao
          ? `Aprovado — pressão dentro da faixa Bosch (${pressao} bar)`
          : 'Aprovado — sem falha registrada',
        peca_aplicada: componente.includes('Bicos') ? 'Jogo de bicos Bosch 0445120' : 'Kit de reparo Bosch original',
        valor_centavos: [89000, 32000, 185000, 240000, 165000, 15000][vi % 6],
        garantia_meses: vi % 4 === 0 ? 6 : 3, km_servico: VEICULOS[vi][7],
        status: 'concluida', aberta_em: iso(dias + 2), concluida_em: iso(dias),
      });
    });

    ['em_bancada', 'aberta'].forEach((status, k) => {
      escopo.inserir('ordens_servico', {
        id: novoId(), cliente_id: ids[k], veiculo_id: veiculoIds[k],
        numero: `OS-${String(2500 + k).padStart(5, '0')}`,
        componente: k === 0 ? 'Bomba injetora Common Rail CP4' : 'Bicos injetores — jogo de 6',
        bancada: k === 0 ? 'CRS 845' : 'EPS 200',
        pressao_bar: null, resultado_laudo: null, peca_aplicada: null,
        valor_centavos: k === 0 ? 240000 : 145000, garantia_meses: 6,
        km_servico: VEICULOS[k][7], status, aberta_em: iso(k + 1), concluida_em: null,
      });
    });
  }

  // ── Pedidos (fazenda e loja) ────────────────────────────────────────────
  const pedidos = { AF: PEDIDOS_AF, FT: PEDIDOS_FT }[codigo] ?? [];
  const prefixo = codigo === 'AF' ? 'AF' : 'FT';
  pedidos.forEach(([ci, diasAtras, ciclo, itens, valor], i) => {
    escopo.inserir('pedidos', {
      id: novoId(), cliente_id: ids[ci],
      numero: `${prefixo}-${String(1200 + i).padStart(5, '0')}`,
      canal: i % 3 === 0 ? 'instagram' : 'whatsapp',
      valor_centavos: valor,
      itens: JSON.stringify(itens.map(([sku, nome, qtd]) => ({ sku, nome, qtd }))),
      status: diasAtras < 3 ? 'separacao' : 'entregue',
      ciclo_recompra_dias: ciclo,
      feito_em: iso(diasAtras), proximo_contato_em: iso(diasAtras - ciclo),
    });
  });

  // ── Pipeline ────────────────────────────────────────────────────────────
  const oportunidades = { MP: OPORTUNIDADES_MP, AF: OPORTUNIDADES_AF, FT: OPORTUNIDADES_FT }[codigo] ?? [];
  oportunidades.forEach(([ci, titulo, etapa, valor, prob, diasAtras], i) => {
    escopo.inserir('oportunidades', {
      id: novoId(), cliente_id: ids[ci], titulo, etapa,
      valor_centavos: valor, probabilidade: prob, posicao: (i + 1) * 1000,
      motivo_perda: etapa === 'perdido' ? 'preço — cliente foi no concorrente' : null,
      criado_em: iso(diasAtras + 20), atualizado_em: iso(diasAtras),
    });
  });

  // ── Atividades ──────────────────────────────────────────────────────────
  const atividades = {
    MP: [
      [0, 'whatsapp', 'Cliente perguntou prazo para reparo da CP4 do Actros.'],
      [0, 'guincho', 'Acionou guincho 24h na BR-135, km 42. Veículo recolhido.'],
      [3, 'orcamento', 'Enviado orçamento de revisão do maquinário pré-safra.'],
      [7, 'visita', 'Visita técnica na garagem para levantamento da frota.'],
    ],
    AF: [
      [1, 'whatsapp', 'Lojista pediu tabela atualizada de revenda.'],
      [4, 'pedido', 'Cesta premiada enviada para São Paulo via transportadora.'],
    ],
    FT: [
      [2, 'orcamento', 'Medição das três torres enviada — 1.240 m² de fachada.'],
      [4, 'visita', 'Visita técnica na laje para medir área de impermeabilização.'],
      [1, 'whatsapp', 'Pintor pediu colorimetria de referência da obra anterior.'],
    ],
  }[codigo] ?? [];
  atividades.forEach(([ci, tipo, desc], i) => {
    escopo.inserir('atividades', {
      id: novoId(), cliente_id: ids[ci], tipo, descricao: desc, criado_em: iso(i + 1),
    });
  });

  banco.auditar({
    empresaId, ator: 'sistema:seed', acao: 'carga_demonstracao',
    entidade: 'empresas', entidadeId: empresaId,
    dados: { empresa: codigo, clientes: ids.length, gerado_em: agora() },
  });

  return { criado: true, empresa: codigo, empresaId, clientes: ids.length };
}

function operadorDe(codigo) {
  return {
    MP: 'balcao@minaspecas.com.br',
    AF: 'adenilde@agrofort.com.br',
    FT: 'loja@forttintas.com.br',
  }[codigo] ?? 'operador@fortgrupo.com.br';
}

function ufDe(cidade) {
  return {
    'São Paulo': 'SP', 'Rio de Janeiro': 'RJ', Brasília: 'DF',
  }[cidade] ?? 'MG';
}

// Execução direta: node src/seed.mjs --reset
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const reset = process.argv.includes('--reset');
  const dir = new URL('../data/instancias/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  for (const e of CATALOGO) {
    const banco = new Banco(`${dir}${e.codigo.toLowerCase()}.db`);
    const r = semear(banco, { empresa: e.codigo, reset });
    console.log(`${e.codigo}: ${r.criado ? `${r.clientes} clientes` : 'já continha dados'}`);
    banco.fechar();
  }
}
