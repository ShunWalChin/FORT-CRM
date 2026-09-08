/**
 * Vida do veículo: quanto ele roda, o que já fez, o que vem a seguir.
 *
 * O CRM sabia registrar o que ACONTECEU. Este módulo é o que o faz prever: a
 * pergunta que sustenta uma oficina não é "quantas ordens fechei", é *"qual
 * caminhão da minha carteira precisa de bico nos próximos trinta dias"*.
 *
 * Três peças, nesta ordem de dependência:
 *
 *   1. o HISTÓRICO de hodômetro, que é o único dado real de uso;
 *   2. a MÉDIA de km/mês, calculada dele — e não digitada;
 *   3. o PLANO, que cruza a média com os intervalos de cada serviço.
 *
 * A média digitada foi o defeito que originou isto. Um caminhão cadastrado
 * como 4.000 km/mês que passou a rodar 1.200 continuava sendo cobrado como se
 * rodasse 4.000: a revisão prevista caía meses antes da hora, o cliente
 * respondia "acabei de fazer", e o operador aprendia a ignorar a fila — que é
 * o pior desfecho possível para uma tela cujo valor inteiro é ser confiável.
 */

import { agora, novoId } from './db.mjs';

const DIA_MS = 24 * 60 * 60 * 1000;
const MES_DIAS = 30.44;   // média real do ano, não 30

/**
 * Plano padrão de uma oficina de injeção diesel.
 *
 * Os intervalos são os de manual de frota pesada em uso rodoviário. Cada um
 * vence por **km ou por tempo, o que chegar primeiro** — o caminhão que roda
 * pouco estraga fluido por idade, e o que roda muito chega ao km antes do ano.
 *
 * É ponto de partida, não regra: o plano vive por veículo e pode ser ajustado.
 * Uma frota urbana de entrega e um bitrem de estrada não têm o mesmo desgaste.
 */
export const PLANO_PADRAO = [
  { chave: 'oleo_motor', nome: 'Óleo do motor e filtro', km: 10000, meses: 6 },
  { chave: 'filtro_combustivel', nome: 'Filtro de combustível', km: 20000, meses: 12 },
  { chave: 'filtro_separador', nome: 'Filtro separador de água', km: 20000, meses: 12 },
  { chave: 'filtro_ar', nome: 'Filtro de ar', km: 20000, meses: 12 },
  { chave: 'teste_bicos', nome: 'Teste de bicos injetores', km: 60000, meses: 24 },
  { chave: 'revisao_bomba', nome: 'Revisão da bomba injetora', km: 120000, meses: 48 },
  { chave: 'fluido_freio', nome: 'Troca do fluido de freio', km: 40000, meses: 24 },
  { chave: 'arrefecimento', nome: 'Aditivo do arrefecimento', km: 60000, meses: 24 },
  { chave: 'correia_dentada', nome: 'Correia dentada', km: 60000, meses: 48 },
];

/** Quanto o veículo anda por mês, a partir do que ele ANDOU. */
export function mediaKmMes(leituras) {
  const ordenadas = [...leituras]
    .filter((l) => Number.isFinite(Number(l.km)) && l.medido_em)
    .sort((a, b) => Date.parse(a.medido_em) - Date.parse(b.medido_em));

  if (ordenadas.length < 2) return null;

  const primeira = ordenadas[0];
  const ultima = ordenadas[ordenadas.length - 1];
  const kmRodado = Number(ultima.km) - Number(primeira.km);
  const dias = (Date.parse(ultima.medido_em) - Date.parse(primeira.medido_em)) / DIA_MS;

  /*
   * Ponta a ponta, e não a média das médias entre leituras consecutivas.
   *
   * Duas leituras no mesmo dia produzem um intervalo de horas; a média por
   * trecho daria peso igual a esse trecho e a um de seis meses, e uma única
   * digitação no mesmo dia distorceria o ano inteiro.
   */
  if (dias < 7 || kmRodado <= 0) return null;

  return Math.round((kmRodado / dias) * MES_DIAS);
}

/**
 * O hodômetro só anda para a frente.
 *
 * Leitura menor que a anterior é erro de digitação (ou troca de painel, que é
 * assunto de outro campo). Aceitar produziria média negativa e uma previsão
 * que nunca vence — o veículo sumiria da fila em silêncio.
 */
export function validarKm(km, anterior) {
  const n = Number(km);
  if (!Number.isFinite(n) || n < 0) return { ok: false, motivo: 'Informe um número de km válido.' };
  if (n > 3_000_000) return { ok: false, motivo: 'Acima de 3.000.000 km — confira o número.' };
  if (anterior != null && n < anterior) {
    return {
      ok: false,
      motivo: `A leitura anterior era ${anterior.toLocaleString('pt-BR')} km. `
        + 'O hodômetro não anda para trás — confira o número, ou registre a troca de painel.',
    };
  }
  return { ok: true, km: Math.round(n) };
}

/**
 * Quando este serviço vence.
 *
 * Devolve as DUAS contas — por km e por tempo — e qual delas mandou. A tela
 * precisa disso: "vence em 12 dias" e "vence em 12 dias porque completa um ano"
 * levam a conversas diferentes com o cliente.
 */
export function projetarServico(plano, { kmHoje, mediaMes, refMs = Date.now() }) {
  const porKm = (() => {
    if (!plano.intervalo_km || kmHoje == null) return null;
    const alvo = (plano.ultimo_km ?? 0) + plano.intervalo_km;
    const faltam = alvo - kmHoje;
    if (!mediaMes || mediaMes <= 0) return { alvo, faltamKm: faltam, dias: null };
    return { alvo, faltamKm: faltam, dias: Math.round((faltam / mediaMes) * MES_DIAS) };
  })();

  const porTempo = (() => {
    if (!plano.intervalo_meses || !plano.ultimo_em) return null;
    const venceMs = Date.parse(plano.ultimo_em) + plano.intervalo_meses * MES_DIAS * DIA_MS;
    return { venceEm: new Date(venceMs).toISOString(), dias: Math.round((venceMs - refMs) / DIA_MS) };
  })();

  const candidatos = [
    porKm?.dias != null ? { dias: porKm.dias, causa: 'km' } : null,
    porTempo ? { dias: porTempo.dias, causa: 'tempo' } : null,
  ].filter(Boolean);

  if (!candidatos.length) return { porKm, porTempo, dias: null, causa: null, previstoEm: null };

  // O que vencer primeiro manda.
  const vencedor = candidatos.reduce((a, b) => (b.dias < a.dias ? b : a));
  return {
    porKm,
    porTempo,
    dias: vencedor.dias,
    causa: vencedor.causa,
    previstoEm: new Date(refMs + vencedor.dias * DIA_MS).toISOString(),
    proximoKm: porKm?.alvo ?? null,
    vencido: vencedor.dias < 0,
  };
}

/** Km estimado hoje, esticando a média desde a última leitura. */
export function kmEstimado(veiculo, ultimaLeitura, mediaMes, refMs = Date.now()) {
  const base = ultimaLeitura?.km ?? veiculo?.km_ultima ?? null;
  if (base == null) return null;
  const desde = ultimaLeitura?.medido_em ?? veiculo?.ultima_visita_em;
  if (!desde || !mediaMes) return base;
  const meses = (refMs - Date.parse(desde)) / (MES_DIAS * DIA_MS);
  if (meses <= 0) return base;
  return Math.round(base + mediaMes * meses);
}

/** Grava a leitura, recalcula a média e reprojeta o plano inteiro. */
export function registrarKm(escopo, veiculoId, { km, medidoEm, origem = 'manual', origemId = null, ator }) {
  const veiculo = escopo.uma('select * from veiculos where {ESCOPO} and id = ?', veiculoId);
  if (!veiculo) throw new Error('veículo não encontrado');

  const anterior = escopo.uma(
    'select km from veiculo_km where {ESCOPO} and veiculo_id = ? order by medido_em desc limit 1',
    veiculoId,
  );
  const v = validarKm(km, anterior?.km ?? null);
  if (!v.ok) throw new Error(v.motivo);

  escopo.inserir('veiculo_km', {
    id: novoId(),
    veiculo_id: veiculoId,
    km: v.km,
    medido_em: medidoEm ?? agora(),
    origem,
    origem_id: origemId,
    criado_por: ator ?? null,
    criado_em: agora(),
  });

  return recalcular(escopo, veiculoId);
}

/**
 * Recalcula média, km do veículo e todas as previsões.
 *
 * Roda depois de toda leitura e de todo serviço concluído. É barato — são
 * dezenas de linhas por veículo — e o alternativo seria projetar a frota
 * inteira a cada abertura de tela.
 */
export function recalcular(escopo, veiculoId, refMs = Date.now()) {
  const leituras = escopo.todas(
    'select km, medido_em from veiculo_km where {ESCOPO} and veiculo_id = ? order by medido_em',
    veiculoId,
  );
  const media = mediaKmMes(leituras);
  const ultima = leituras[leituras.length - 1] ?? null;

  escopo.atualizar('veiculos', veiculoId, {
    ...(media != null ? { media_km_mes: media } : {}),
    ...(ultima ? { km_ultima: ultima.km, ultima_visita_em: ultima.medido_em } : {}),
  });

  const veiculo = escopo.uma('select * from veiculos where {ESCOPO} and id = ?', veiculoId);
  const hoje = kmEstimado(veiculo, ultima, media, refMs);

  const planos = escopo.todas(
    'select * from planos_manutencao where {ESCOPO} and veiculo_id = ? and ativo = 1', veiculoId,
  );
  for (const plano of planos) {
    const p = projetarServico(plano, { kmHoje: hoje, mediaMes: media, refMs });
    escopo.atualizar('planos_manutencao', plano.id, {
      proximo_km: p.proximoKm ?? null,
      previsto_em: p.previstoEm ?? null,
      atualizado_em: agora(),
    });
  }

  return { media, kmHoje: hoje, leituras: leituras.length, planos: planos.length };
}

/** Instala o plano padrão num veículo que ainda não tem nenhum. */
export function semearPlano(escopo, veiculoId, { kmBase = null, dataBase = null } = {}) {
  const jaTem = escopo.contar('planos_manutencao', 'and veiculo_id = ?', veiculoId);
  if (jaTem) return 0;

  for (const s of PLANO_PADRAO) {
    escopo.inserir('planos_manutencao', {
      id: novoId(),
      veiculo_id: veiculoId,
      servico_chave: s.chave,
      servico_nome: s.nome,
      intervalo_km: s.km,
      intervalo_meses: s.meses,
      ultimo_km: kmBase,
      ultimo_em: dataBase,
      proximo_km: null,
      previsto_em: null,
      ativo: 1,
      criado_em: agora(),
      atualizado_em: agora(),
    });
  }
  return PLANO_PADRAO.length;
}

/**
 * A vida do veículo numa linha do tempo só.
 *
 * Ordens de serviço, vistorias e leituras de hodômetro vêm de três tabelas e
 * respondem à mesma pergunta — *o que aconteceu com este caminhão?*. Deixar a
 * tela juntar as três seria repetir a junção em cada lugar que precisasse dela.
 */
export function linhaDoTempo(escopo, veiculoId, { limite = 60 } = {}) {
  const eventos = [];

  for (const o of escopo.todas(
    `select id, numero, componente, status, valor_centavos, km_servico, aberta_em, concluida_em
     from ordens_servico where {ESCOPO} and veiculo_id = ? order by aberta_em desc limit ?`,
    veiculoId, limite,
  )) {
    eventos.push({
      tipo: 'ordem_servico',
      em: o.concluida_em ?? o.aberta_em,
      titulo: `OS ${o.numero} — ${o.componente}`,
      detalhe: o.status,
      km: o.km_servico,
      valor_centavos: o.valor_centavos,
      id: o.id,
    });
  }

  for (const v of escopo.todas(
    `select id, numero, status, km, iniciada_em, aceite_em from vistorias
     where {ESCOPO} and veiculo_id = ? order by iniciada_em desc limit ?`,
    veiculoId, limite,
  )) {
    eventos.push({
      tipo: 'vistoria',
      em: v.aceite_em ?? v.iniciada_em,
      titulo: `Vistoria ${v.numero}`,
      detalhe: v.status,
      km: v.km,
      id: v.id,
    });
  }

  for (const k of escopo.todas(
    `select id, km, medido_em, origem from veiculo_km
     where {ESCOPO} and veiculo_id = ? and origem = 'manual' order by medido_em desc limit ?`,
    veiculoId, limite,
  )) {
    eventos.push({
      tipo: 'leitura_km',
      em: k.medido_em,
      titulo: `${Number(k.km).toLocaleString('pt-BR')} km`,
      detalhe: 'leitura de hodômetro',
      km: k.km,
      id: k.id,
    });
  }

  return eventos.sort((a, b) => Date.parse(b.em) - Date.parse(a.em)).slice(0, limite);
}
