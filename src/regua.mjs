/**
 * Régua de contato — o motor que responde "com quem falar hoje, e por quê".
 *
 * Cada gatilho é uma função pura sobre dados já carregados: recebe o retrato da
 * empresa e a data de referência, devolve candidatos com contexto. Nada aqui
 * envia; quem envia é o serviço de disparo, e só depois de o compliance
 * aprovar. Separar as duas coisas é o que permite mostrar a fila do dia numa
 * reunião sem risco de sair mensagem.
 *
 * A projeção de quilometragem é a peça que faz a régua da oficina funcionar:
 * o veículo não avisa quando chega nos 20.000 km, então o sistema estima a
 * data pela média de rodagem calculada entre passagens.
 */

const DIA_MS = 24 * 60 * 60 * 1000;
const KM_REVISAO_INJECAO = 20000;

export function dias(a, b) {
  return Math.round((Date.parse(a) - Date.parse(b)) / DIA_MS);
}

function diasDesde(dataIso, refMs) {
  if (!dataIso) return null;
  return Math.floor((refMs - Date.parse(dataIso)) / DIA_MS);
}

function emDias(refMs, n) {
  return new Date(refMs + n * DIA_MS).toISOString();
}

function moeda(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Marcadores de razão social. Cortar no primeiro espaço funciona para pessoa —
 * "Sebastião Alves Pereira" vira "Sebastião" — e estraga para empresa:
 * "Fazenda Boa Vista LTDA" viraria "Fazenda", e a mensagem chegaria como
 * "Boa tarde, Fazenda!". Numa régua que existe para soar como gente, isso é o
 * bastante para o cliente perceber que é robô.
 */
const MARCADOR_EMPRESA =
  /\b(ltda|me|epp|eireli|s\/?a|sa|mei|cia|fazenda|agropecu[áa]ria|transportes?|construtora|empório|emporio|casa|mercearia|delicatessen|com[ée]rcio|ind[úu]stria|distribuidora|auto|centro|loja)\b/i;

const SUFIXO_DESCARTAVEL = /\s+(ltda\.?|me|epp|eireli|s\/?a\.?|mei|cia\.?)\.?$/i;

/**
 * Como chamar o contato. Pessoa recebe primeiro nome; empresa recebe a razão
 * social sem o sufixo jurídico, que ninguém fala em voz alta.
 */
function tratamento(nome) {
  const limpo = String(nome ?? '').trim();
  if (!limpo) return '';
  if (MARCADOR_EMPRESA.test(limpo)) return limpo.replace(SUFIXO_DESCARTAVEL, '').trim();
  return limpo.split(/\s+/)[0];
}

/**
 * Projeta quando o veículo atinge a próxima revisão de injeção.
 * Devolve null quando não há média de rodagem — sem ela não há projeção
 * honesta, e chutar geraria aviso errado no celular de um cliente real.
 */
export function projetarRevisao(veiculo, refMs) {
  if (!veiculo.km_ultima || !veiculo.media_km_mes || veiculo.media_km_mes <= 0) return null;

  const alvoKm = veiculo.km_ultima + KM_REVISAO_INJECAO;
  const mesesDesde = veiculo.ultima_visita_em
    ? (refMs - Date.parse(veiculo.ultima_visita_em)) / (30 * DIA_MS)
    : 0;
  const kmEstimadoHoje = Math.round(veiculo.km_ultima + veiculo.media_km_mes * mesesDesde);
  const kmFaltando = alvoKm - kmEstimadoHoje;
  const kmPorDia = veiculo.media_km_mes / 30;
  const diasFaltando = Math.round(kmFaltando / kmPorDia);

  return {
    alvoKm,
    kmEstimadoHoje,
    kmFaltando,
    diasFaltando,
    dataPrevista: emDias(refMs, diasFaltando),
  };
}

/**
 * Os doze gatilhos do projeto. `chave` casa com a tabela `gatilhos`, de onde
 * vêm template, antecedência e cooldown — o motor é a regra, o texto é dado.
 */
export const GATILHOS = {
  // ── Minas Peças ─────────────────────────────────────────────────────────
  revisao_injecao: {
    empresa: 'MP',
    nome: 'Revisão de injeção',
    descricao: 'A cada 20.000 km, projetado pela média de rodagem entre passagens.',
    regra: '20.000 km — aviso com 15 dias de antecedência',
    antecedencia_dias: 15,
    cooldown_dias: 45,
    template:
      '{{saudacao}}, aqui é da {{empresa}}. O {{modelo}} de placa {{placa}} passou aqui em {{ultima_visita}} com {{km_ultima}} km. Pelo que o senhor roda, já deve estar chegando na revisão de injeção — quer que eu reserve a bancada pra essa semana? Assim não perde dia parado.',
    buscar(ctx) {
      const saida = [];
      for (const v of ctx.veiculos) {
        const p = projetarRevisao(v, ctx.refMs);
        if (!p) continue;
        if (p.diasFaltando > 15) continue;
        const cliente = ctx.clientePorId.get(v.cliente_id);
        if (!cliente) continue;
        saida.push({
          cliente,
          urgencia: p.diasFaltando < 0 ? 'vencido' : p.diasFaltando <= 7 ? 'alta' : 'media',
          vencimentoEm: p.dataPrevista,
          contexto: `${v.placa} · ${p.kmEstimadoHoje.toLocaleString('pt-BR')} km estimados · alvo ${p.alvoKm.toLocaleString('pt-BR')} km`,
          variaveis: {
            placa: v.placa,
            modelo: [v.marca, v.modelo].filter(Boolean).join(' '),
            km_ultima: (v.km_ultima ?? 0).toLocaleString('pt-BR'),
            ultima_visita: formatarMes(v.ultima_visita_em),
          },
        });
      }
      return saida;
    },
  },

  filtro_diesel: {
    empresa: 'MP',
    nome: 'Filtro de diesel',
    descricao: 'Seis meses desde a última passagem pela oficina.',
    regra: '6 meses — aviso com 10 dias de antecedência',
    antecedencia_dias: 10,
    cooldown_dias: 90,
    template:
      '{{saudacao}}! Faz {{meses}} meses que o {{placa}} não passa aqui pra troca do filtro de diesel. É serviço rápido e evita entupir bico. Quer que eu separe o filtro?',
    buscar(ctx) {
      const saida = [];
      for (const v of ctx.veiculos) {
        const d = diasDesde(v.ultima_visita_em, ctx.refMs);
        if (d === null || d < 170) continue;
        const cliente = ctx.clientePorId.get(v.cliente_id);
        if (!cliente) continue;
        saida.push({
          cliente,
          urgencia: d > 200 ? 'alta' : 'media',
          vencimentoEm: emDias(ctx.refMs, 180 - d),
          contexto: `${v.placa} · última visita há ${d} dias`,
          variaveis: { placa: v.placa, meses: Math.floor(d / 30) },
        });
      }
      return saida;
    },
  },

  preventiva_frota: {
    empresa: 'MP',
    nome: 'Preventiva de frota',
    descricao: 'Clientes com dois ou mais veículos, com agenda escalonada.',
    regra: 'Mensal, escalonada para não parar a operação inteira',
    antecedencia_dias: 0,
    cooldown_dias: 30,
    template:
      '{{saudacao}}! Dos {{total}} veículos da frota, {{vencendo}} estão com a revisão de injeção vencendo este mês. Posso agendar um por semana pra não parar a operação de uma vez?',
    buscar(ctx) {
      const porCliente = new Map();
      for (const v of ctx.veiculos) {
        if (!porCliente.has(v.cliente_id)) porCliente.set(v.cliente_id, []);
        porCliente.get(v.cliente_id).push(v);
      }
      const saida = [];
      for (const [clienteId, lista] of porCliente) {
        if (lista.length < 2) continue;
        const cliente = ctx.clientePorId.get(clienteId);
        if (!cliente || cliente.perfil !== 'frota') continue;
        const vencendo = lista.filter((v) => {
          const p = projetarRevisao(v, ctx.refMs);
          return p && p.diasFaltando <= 30;
        }).length;
        if (vencendo === 0) continue;
        saida.push({
          cliente,
          urgencia: vencendo >= 2 ? 'alta' : 'media',
          vencimentoEm: emDias(ctx.refMs, 7),
          contexto: `${lista.length} veículos · ${vencendo} vencendo em 30 dias`,
          variaveis: { total: lista.length, vencendo },
        });
      }
      return saida;
    },
  },

  fim_garantia: {
    empresa: 'MP',
    nome: 'Fim de garantia',
    descricao: 'Trinta dias antes de a garantia do serviço vencer.',
    regra: 'Aviso 30 dias antes do vencimento',
    antecedencia_dias: 30,
    cooldown_dias: 180,
    template:
      '{{saudacao}}, a garantia do serviço de {{componente}} feito no {{placa}} vence em {{dias}} dias. Se quiser, a gente dá uma conferida antes de vencer — sem custo.',
    buscar(ctx) {
      const saida = [];
      for (const os of ctx.ordens) {
        if (os.status !== 'concluida' || !os.concluida_em) continue;
        const vence = Date.parse(os.concluida_em) + os.garantia_meses * 30 * DIA_MS;
        const faltam = Math.round((vence - ctx.refMs) / DIA_MS);
        if (faltam > 30 || faltam < 0) continue;
        const cliente = ctx.clientePorId.get(os.cliente_id);
        if (!cliente) continue;
        const v = ctx.veiculoPorId.get(os.veiculo_id);
        saida.push({
          cliente,
          urgencia: faltam <= 10 ? 'alta' : 'media',
          vencimentoEm: new Date(vence).toISOString(),
          contexto: `OS ${os.numero} · ${os.componente} · garantia vence em ${faltam} dias`,
          variaveis: { componente: os.componente, placa: v?.placa ?? '—', dias: faltam },
        });
      }
      return saida;
    },
  },

  orcamento_parado: {
    empresa: 'MP',
    nome: 'Orçamento parado',
    descricao: 'Oportunidade que ficou em orçamento e não andou.',
    regra: 'Nova abordagem aos 30 e aos 90 dias',
    antecedencia_dias: 0,
    cooldown_dias: 60,
    template:
      '{{saudacao}}, passei pra saber do orçamento de {{titulo}} que a gente mandou. Ainda faz sentido pro senhor? Se o valor foi o problema, consigo ver uma condição.',
    buscar(ctx) {
      const saida = [];
      for (const op of ctx.oportunidades) {
        if (op.etapa !== 'orcamento' && op.etapa !== 'negociacao') continue;
        const d = diasDesde(op.atualizado_em, ctx.refMs);
        if (d === null || d < 30) continue;
        const cliente = ctx.clientePorId.get(op.cliente_id);
        if (!cliente) continue;
        saida.push({
          cliente,
          urgencia: d >= 90 ? 'alta' : 'media',
          vencimentoEm: op.atualizado_em,
          contexto: `${op.titulo} · ${moeda(op.valor_centavos)} · parado há ${d} dias`,
          variaveis: { titulo: op.titulo, valor: moeda(op.valor_centavos), dias: d },
        });
      }
      return saida;
    },
  },

  pos_servico: {
    empresa: 'MP',
    nome: 'Pós-serviço com laudo',
    descricao: 'Três dias após a conclusão da ordem de serviço.',
    regra: '3 dias após a entrega do veículo',
    antecedencia_dias: 0,
    cooldown_dias: 30,
    template:
      '{{saudacao}}, tudo certo com o {{placa}} depois do serviço? Qualquer coisa fora do normal, me chama que a gente resolve — a garantia está registrada aqui no sistema.',
    buscar(ctx) {
      const saida = [];
      for (const os of ctx.ordens) {
        if (os.status !== 'concluida' || !os.concluida_em) continue;
        const d = diasDesde(os.concluida_em, ctx.refMs);
        if (d === null || d < 3 || d > 10) continue;
        const cliente = ctx.clientePorId.get(os.cliente_id);
        if (!cliente) continue;
        const v = ctx.veiculoPorId.get(os.veiculo_id);
        saida.push({
          cliente,
          urgencia: 'media',
          vencimentoEm: emDias(ctx.refMs, 0),
          contexto: `OS ${os.numero} · concluída há ${d} dias`,
          variaveis: { placa: v?.placa ?? '—', componente: os.componente },
        });
      }
      return saida;
    },
  },

  pre_safra: {
    empresa: 'MP',
    nome: 'Pré-safra',
    descricao: 'Produtor rural, antes da janela de plantio ou colheita.',
    regra: 'Sazonal — conforme calendário agrícola',
    antecedencia_dias: 0,
    cooldown_dias: 150,
    template:
      '{{saudacao}}, a safra tá chegando. Quer deixar a injeção do maquinário revisada antes? Parar trator no meio da lavoura custa muito mais caro que a revisão.',
    buscar(ctx) {
      const mes = new Date(ctx.refMs).getMonth() + 1;
      // Janelas de pré-safra no Norte de Minas: pré-plantio e pré-colheita.
      const janela = [8, 9, 2, 3].includes(mes);
      if (!janela) return [];
      return ctx.clientes
        .filter((c) => c.perfil === 'produtor_rural')
        .map((cliente) => ({
          cliente,
          urgencia: 'media',
          vencimentoEm: emDias(ctx.refMs, 30),
          contexto: `Produtor rural · janela de pré-safra (mês ${mes})`,
          variaveis: {},
        }));
    },
  },

  // ── Fazenda Agrofort ────────────────────────────────────────────────────
  recompra: {
    empresa: 'AF',
    nome: 'Recompra por ciclo',
    descricao: 'Passado o ciclo do produto, a mensagem sai com o item que a pessoa já levou.',
    regra: 'Ciclo previsível por produto',
    antecedencia_dias: 0,
    cooldown_dias: 20,
    template:
      '{{saudacao}}! Faz {{dias}} dias que a senhora levou o {{produto}}. Acabou por aí? Essa semana tem fornada nova saindo da fazenda — quer que eu já separe?',
    buscar(ctx) {
      const saida = [];
      const ultimoPorCliente = new Map();
      for (const p of ctx.pedidos) {
        const atual = ultimoPorCliente.get(p.cliente_id);
        if (!atual || Date.parse(p.feito_em) > Date.parse(atual.feito_em)) {
          ultimoPorCliente.set(p.cliente_id, p);
        }
      }
      for (const [clienteId, p] of ultimoPorCliente) {
        const d = diasDesde(p.feito_em, ctx.refMs);
        if (d === null || d < p.ciclo_recompra_dias) continue;
        if (d > p.ciclo_recompra_dias + 45) continue; // acima disso vira reativação
        const cliente = ctx.clientePorId.get(clienteId);
        if (!cliente) continue;
        const itens = seguroJson(p.itens);
        saida.push({
          cliente,
          urgencia: d > p.ciclo_recompra_dias + 15 ? 'alta' : 'media',
          vencimentoEm: p.proximo_contato_em ?? emDias(ctx.refMs, 0),
          contexto: `Último pedido ${p.numero} há ${d} dias · ciclo de ${p.ciclo_recompra_dias} dias`,
          variaveis: { dias: d, produto: itens[0]?.nome ?? 'queijo', pedido: p.numero },
        });
      }
      return saida;
    },
  },

  reativacao: {
    empresa: 'AF',
    nome: 'Reativação de inativo',
    descricao: 'Cliente sem compra há mais de noventa dias.',
    regra: '90 dias sem pedido',
    antecedencia_dias: 0,
    cooldown_dias: 120,
    template:
      '{{saudacao}}, faz tempo que a senhora não pede nada da fazenda! Saiu queijo maturado novo e o meia cura que ganhou o ouro no Prêmio Queijo Brasil. Quer provar?',
    buscar(ctx) {
      const ultimo = new Map();
      for (const p of ctx.pedidos) {
        const atual = ultimo.get(p.cliente_id);
        if (!atual || Date.parse(p.feito_em) > Date.parse(atual)) ultimo.set(p.cliente_id, p.feito_em);
      }
      const saida = [];
      for (const cliente of ctx.clientes) {
        const ult = ultimo.get(cliente.id);
        if (!ult) continue;
        const d = diasDesde(ult, ctx.refMs);
        if (d === null || d < 90) continue;
        saida.push({
          cliente,
          urgencia: d > 150 ? 'alta' : 'media',
          vencimentoEm: ult,
          contexto: `Sem pedido há ${d} dias`,
          variaveis: { dias: d },
        });
      }
      return saida;
    },
  },

  sazonal: {
    empresa: 'AF',
    nome: 'Campanha sazonal',
    descricao: 'Datas do calendário viram campanha para a base própria, sem custo de mídia.',
    regra: 'Dia das Mães, festas juninas, Natal e safra',
    antecedencia_dias: 20,
    cooldown_dias: 60,
    template:
      '{{saudacao}}! Estamos montando as cestas de {{ocasiao}} com os queijos premiados da fazenda. Quer reservar a sua? As primeiras saem primeiro.',
    buscar(ctx) {
      const d = new Date(ctx.refMs);
      const ocasiao = ocasiaoDoMes(d.getMonth() + 1);
      if (!ocasiao) return [];
      return ctx.clientes
        .filter((c) => c.perfil === 'consumidor' || c.perfil === 'particular')
        .map((cliente) => ({
          cliente,
          urgencia: 'media',
          vencimentoEm: emDias(ctx.refMs, 20),
          contexto: `Campanha de ${ocasiao}`,
          variaveis: { ocasiao },
        }));
    },
  },

  revenda_followup: {
    empresa: 'AF',
    nome: 'Follow-up de revenda',
    descricao: 'Lojista é outro cliente, outra conversa e ticket muito maior.',
    regra: '45 dias sem reposição',
    antecedencia_dias: 0,
    cooldown_dias: 30,
    template:
      '{{saudacao}}, como está a saída do queijo aí na loja? Faz {{dias}} dias da última reposição. Quer que eu programe a próxima carga pra semana que vem?',
    buscar(ctx) {
      const ultimo = new Map();
      for (const p of ctx.pedidos) {
        const atual = ultimo.get(p.cliente_id);
        if (!atual || Date.parse(p.feito_em) > Date.parse(atual)) ultimo.set(p.cliente_id, p.feito_em);
      }
      const saida = [];
      for (const cliente of ctx.clientes) {
        if (cliente.perfil !== 'revenda') continue;
        const ult = ultimo.get(cliente.id);
        const d = ult ? diasDesde(ult, ctx.refMs) : 999;
        if (d < 45) continue;
        saida.push({
          cliente,
          urgencia: 'alta',
          vencimentoEm: ult ?? emDias(ctx.refMs, 0),
          contexto: ult ? `Última reposição há ${d} dias` : 'Nunca repôs',
          variaveis: { dias: d },
        });
      }
      return saida;
    },
  },

  boas_vindas: {
    empresa: 'AF',
    nome: 'Boas-vindas ao primeiro pedido',
    descricao: 'Dois dias após a primeira compra — é onde se ganha o segundo pedido.',
    regra: '2 dias após o primeiro pedido do cliente',
    antecedencia_dias: 0,
    cooldown_dias: 365,
    template:
      '{{saudacao}}! Aqui é a Adenilde, da Fazenda Agrofort. Seu primeiro pedido saiu daqui com carinho. Chegou bem? Qualquer coisa me fala direto — gosto de saber o que o cliente achou.',
    buscar(ctx) {
      const contagem = new Map();
      const primeiro = new Map();
      for (const p of [...ctx.pedidos].sort((a, b) => Date.parse(a.feito_em) - Date.parse(b.feito_em))) {
        contagem.set(p.cliente_id, (contagem.get(p.cliente_id) ?? 0) + 1);
        if (!primeiro.has(p.cliente_id)) primeiro.set(p.cliente_id, p);
      }
      const saida = [];
      for (const [clienteId, p] of primeiro) {
        if (contagem.get(clienteId) !== 1) continue;
        const d = diasDesde(p.feito_em, ctx.refMs);
        if (d === null || d < 2 || d > 12) continue;
        const cliente = ctx.clientePorId.get(clienteId);
        if (!cliente) continue;
        saida.push({
          cliente,
          urgencia: 'alta',
          vencimentoEm: emDias(ctx.refMs, 0),
          contexto: `Primeiro pedido ${p.numero} há ${d} dias`,
          variaveis: { pedido: p.numero },
        });
      }
      return saida;
    },
  },

  // ── Fort Tintas ─────────────────────────────────────────────────────────
  // A régua de uma loja de tintas não é a de recompra comum: tinta não acaba
  // sozinha, ela acaba porque a obra andou. O que dá sinal é a SEQUÊNCIA da
  // obra, não o calendário.

  obra_em_andamento: {
    empresa: 'FT',
    nome: 'Obra parada no meio',
    descricao: 'Comprou preparação (massa, selador) e não voltou para a tinta.',
    regra: 'Preparação sem tinta em 12 dias',
    antecedencia_dias: 0,
    cooldown_dias: 30,
    template:
      '{{saudacao}}! Vi que o senhor levou {{preparacao}} aqui faz {{dias}} dias. Já está na hora da tinta? Tenho a acrílica premium na cor que combina com o que o senhor levou — separo pra hoje?',
    buscar(ctx) {
      // A sequência real de uma obra: massa corrida e selador vêm antes da
      // tinta. Quem comprou o começo e não voltou está prestes a comprar
      // tinta — de nós ou do concorrente. É a janela mais quente da loja.
      const PREPARACAO = ['FT-MAS-18L', 'FT-SEL-18L', 'FT-TEX-25K'];
      const TINTA = ['FT-ACR-18L', 'FT-ACR-36L', 'FT-ESM-36L'];

      const porCliente = new Map();
      for (const p of ctx.pedidos) {
        if (!porCliente.has(p.cliente_id)) porCliente.set(p.cliente_id, []);
        porCliente.get(p.cliente_id).push(p);
      }

      const saida = [];
      for (const [clienteId, lista] of porCliente) {
        const comPrep = lista
          .filter((p) => seguroJson(p.itens).some((i) => PREPARACAO.includes(i.sku)))
          .sort((a, b) => Date.parse(b.feito_em) - Date.parse(a.feito_em))[0];
        if (!comPrep) continue;

        const d = diasDesde(comPrep.feito_em, ctx.refMs);
        if (d === null || d < 12 || d > 90) continue;

        // Já voltou para a tinta DEPOIS da preparação? Então a obra andou e
        // não há o que cobrar.
        const comprouTinta = lista.some(
          (p) => Date.parse(p.feito_em) > Date.parse(comPrep.feito_em)
            && seguroJson(p.itens).some((i) => TINTA.includes(i.sku)),
        );
        if (comprouTinta) continue;

        const cliente = ctx.clientePorId.get(clienteId);
        if (!cliente) continue;

        const itens = seguroJson(comPrep.itens).filter((i) => PREPARACAO.includes(i.sku));
        saida.push({
          cliente,
          urgencia: d <= 25 ? 'alta' : 'media',
          vencimentoEm: comPrep.feito_em,
          contexto: `${comPrep.numero} · preparação há ${d} dias, sem tinta depois`,
          variaveis: { dias: d, preparacao: itens.map((i) => i.nome).join(' e ') || 'material de preparação' },
        });
      }
      return saida;
    },
  },

  recompra_tinta: {
    empresa: 'FT',
    nome: 'Recompra por ciclo',
    descricao: 'Passado o ciclo do produto — repintura, manutenção, reposição.',
    regra: 'Ciclo do item comprado',
    antecedencia_dias: 0,
    cooldown_dias: 45,
    template:
      '{{saudacao}}! Faz {{dias}} dias que o senhor levou {{produto}}. Se a obra continua ou já é hora da manutenção, tenho pronta entrega — quer que eu reserve?',
    buscar(ctx) {
      const ultimo = new Map();
      for (const p of ctx.pedidos) {
        const atual = ultimo.get(p.cliente_id);
        if (!atual || Date.parse(p.feito_em) > Date.parse(atual.feito_em)) ultimo.set(p.cliente_id, p);
      }
      const saida = [];
      for (const [clienteId, p] of ultimo) {
        const d = diasDesde(p.feito_em, ctx.refMs);
        if (d === null || d < p.ciclo_recompra_dias) continue;
        if (d > p.ciclo_recompra_dias + 120) continue;
        const cliente = ctx.clientePorId.get(clienteId);
        if (!cliente) continue;
        saida.push({
          cliente,
          urgencia: d > p.ciclo_recompra_dias + 40 ? 'alta' : 'media',
          vencimentoEm: p.proximo_contato_em ?? emDias(ctx.refMs, 0),
          contexto: `Último pedido ${p.numero} há ${d} dias · ciclo de ${p.ciclo_recompra_dias} dias`,
          variaveis: { dias: d, produto: seguroJson(p.itens)[0]?.nome ?? 'o material' },
        });
      }
      return saida;
    },
  },

  pintor_reposicao: {
    empresa: 'FT',
    nome: 'Reposição de profissional',
    descricao: 'Pintor e empreiteira compram em ciclo curto — sumiço é perda de conta.',
    regra: '40 dias sem compra, perfil profissional',
    antecedencia_dias: 0,
    cooldown_dias: 30,
    template:
      '{{saudacao}}, tudo certo por aí? Faz {{dias}} dias que o senhor não passa aqui. Pegou obra nova? Me fala o que vai precisar que eu já separo e mando entregar.',
    buscar(ctx) {
      const ultimo = new Map();
      for (const p of ctx.pedidos) {
        const atual = ultimo.get(p.cliente_id);
        if (!atual || Date.parse(p.feito_em) > Date.parse(atual)) ultimo.set(p.cliente_id, p.feito_em);
      }
      const saida = [];
      for (const cliente of ctx.clientes) {
        if (cliente.perfil !== 'revenda' && cliente.perfil !== 'frota') continue;
        const ult = ultimo.get(cliente.id);
        const d = ult ? diasDesde(ult, ctx.refMs) : null;
        if (d === null || d < 40) continue;
        saida.push({
          cliente,
          urgencia: d > 90 ? 'alta' : 'media',
          vencimentoEm: ult,
          contexto: `Profissional · última compra há ${d} dias`,
          variaveis: { dias: d },
        });
      }
      return saida;
    },
  },

  pos_obra: {
    empresa: 'FT',
    nome: 'Pós-venda de obra',
    descricao: 'Quinze dias após uma compra grande — é quando a tinta já secou.',
    regra: '15 dias após pedido acima de R$ 500',
    antecedencia_dias: 0,
    cooldown_dias: 60,
    template:
      '{{saudacao}}, como ficou a pintura? Se sobrou tinta, guarde bem fechada que dura. E se faltou alguma coisa pro acabamento, me chama que eu resolvo hoje.',
    buscar(ctx) {
      const saida = [];
      for (const p of ctx.pedidos) {
        if (p.valor_centavos < 50000) continue;
        const d = diasDesde(p.feito_em, ctx.refMs);
        if (d === null || d < 15 || d > 40) continue;
        const cliente = ctx.clientePorId.get(p.cliente_id);
        if (!cliente) continue;
        saida.push({
          cliente,
          urgencia: 'media',
          vencimentoEm: emDias(ctx.refMs, 0),
          contexto: `${p.numero} · ${(p.valor_centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} há ${d} dias`,
          variaveis: { pedido: p.numero },
        });
      }
      return saida;
    },
  },

  orcamento_parado_loja: {
    empresa: 'FT',
    nome: 'Orçamento parado',
    descricao: 'Orçamento de obra que não andou — em tinta, o concorrente é a esquina.',
    regra: 'Nova abordagem aos 21 dias',
    antecedencia_dias: 0,
    cooldown_dias: 45,
    template:
      '{{saudacao}}, passei pra saber do orçamento de {{titulo}}. A obra andou? Se for o preço, consigo fechar melhor no volume — e a entrega em obra continua por nossa conta.',
    buscar(ctx) {
      const saida = [];
      for (const op of ctx.oportunidades) {
        if (op.etapa !== 'orcamento' && op.etapa !== 'negociacao') continue;
        const d = diasDesde(op.atualizado_em, ctx.refMs);
        if (d === null || d < 21) continue;
        const cliente = ctx.clientePorId.get(op.cliente_id);
        if (!cliente) continue;
        saida.push({
          cliente,
          urgencia: d >= 60 ? 'alta' : 'media',
          vencimentoEm: op.atualizado_em,
          contexto: `${op.titulo} · ${moeda(op.valor_centavos)} · parado há ${d} dias`,
          variaveis: { titulo: op.titulo, valor: moeda(op.valor_centavos), dias: d },
        });
      }
      return saida;
    },
  },
};

function ocasiaoDoMes(mes) {
  return (
    {
      4: 'Dia das Mães',
      5: 'Dia das Mães',
      6: 'festa junina',
      8: 'Dia dos Pais',
      11: 'Natal',
      12: 'Natal e Ano Novo',
    }[mes] ?? null
  );
}

function formatarMes(iso) {
  if (!iso) return 'sua última passagem';
  const d = new Date(iso);
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function seguroJson(texto) {
  try {
    const v = JSON.parse(texto);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Saudação por hora do dia e tratamento — a mensagem tem que soar como gente. */
export function saudacao(cliente, refMs) {
  const h = new Date(refMs).getHours();
  const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const como = tratamento(cliente.nome);
  return como ? `${periodo}, ${como}` : periodo;
}

export { tratamento };

/** Substitui {{variaveis}} do template. O que não existir vira string vazia. */
export function renderizar(template, variaveis) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, chave) =>
    variaveis[chave] === undefined || variaveis[chave] === null ? '' : String(variaveis[chave]),
  );
}

/**
 * Por que a fila está vazia.
 *
 * A tela dizia "a régua já cobriu todo mundo — volte amanhã". Isso AFIRMA uma
 * causa que ninguém verificou: a fila também fica vazia quando os gatilhos
 * estão desligados, quando ninguém na base tem consentimento, ou quando a base
 * está vazia. Mandar o operador voltar amanhã nesses casos é pedir que ele
 * espere por algo que nunca vai acontecer sozinho.
 *
 * As causas são checadas na ordem em que se resolvem: não adianta falar de
 * consentimento para quem não tem cliente nenhum cadastrado.
 *
 * Cada causa devolve uma AÇÃO — a tela vazia sem saída é o problema; dizer o
 * motivo sem dizer o que fazer resolve metade dele.
 */
export function diagnosticarFilaVazia(escopo, { fila = [], adiados = [] } = {}) {
  /*
   * Adiado vem PRIMEIRO, antes de qualquer outra causa.
   *
   * Se a fila está vazia porque o próprio operador adiou tudo, dizer "os
   * gatilhos estão desligados" seria mandá-lo mexer no lugar errado. E é a
   * causa mais fácil de esquecer: quem adiou na terça não lembra na quinta.
   */
  if (adiados.length) {
    const proximo = adiados.map((a) => a.ate).sort()[0];
    return {
      causa: 'tudo_adiado',
      titulo: adiados.length === 1
        ? '1 contato adiado por você'
        : `${adiados.length} contatos adiados por você`,
      texto: 'A fila está vazia porque estes foram adiados, não porque não há trabalho. '
        + `O primeiro volta em ${new Date(proximo).toLocaleDateString('pt-BR')}.`,
      acao: null,
      adiados,
      tranquilo: true,
    };
  }

  const clientes = escopo.contar('clientes');
  const comConsentimento = escopo.contar('clientes', 'and consentimento_lgpd = 1 and opt_out_em is null');
  const gatilhos = escopo.contar('gatilhos');
  const gatilhosAtivos = escopo.contar('gatilhos', 'and ativo = 1');
  const bloqueados = fila.filter((f) => !f.decisao?.permitido).length;

  if (!clientes) {
    return {
      causa: 'base_vazia',
      titulo: 'Ainda não há clientes cadastrados',
      texto: 'A régua monta a fila a partir da base. Sem cliente, não há de quem falar.',
      acao: { rota: 'clientes', rotulo: 'Cadastrar o primeiro cliente' },
      segunda: { rota: 'importar', rotulo: 'Ou importar uma base' },
    };
  }

  if (!gatilhosAtivos) {
    return {
      causa: 'gatilhos_desligados',
      titulo: gatilhos
        ? `Os ${gatilhos} gatilhos estão desligados`
        : 'Não há gatilhos configurados',
      texto: 'São eles que decidem quem entra na fila. Com todos desligados, ela fica '
        + 'vazia mesmo com a base cheia — e isso não se resolve esperando.',
      acao: { rota: 'gatilhos', rotulo: 'Ligar os gatilhos' },
    };
  }

  if (!comConsentimento) {
    return {
      causa: 'sem_consentimento',
      titulo: `Nenhum dos ${clientes} clientes autorizou receber mensagem`,
      texto: 'Sem consentimento LGPD registrado, o compliance bloqueia antes de a fila se '
        + 'formar. O consentimento é marcado na ficha de cada cliente.',
      acao: { rota: 'clientes', rotulo: 'Ver a base' },
    };
  }

  if (bloqueados) {
    return {
      causa: 'todos_bloqueados',
      titulo: `${bloqueados} ${bloqueados === 1 ? 'contato está bloqueado' : 'contatos estão bloqueados'}, nenhum liberado`,
      texto: 'Há gente na fila, mas o compliance recusou todos. Os motivos estão logo acima — '
        + 'e recusa não é defeito: é o que protege o número da empresa.',
      acao: null,
    };
  }

  return {
    causa: 'coberto',
    titulo: 'Nada para hoje',
    texto: `Os ${gatilhosAtivos} gatilhos estão ativos e ${comConsentimento} clientes podem `
      + 'receber mensagem — ninguém se encaixa nas regras neste momento. A fila se refaz '
      + 'sozinha conforme os prazos vencem.',
    acao: { rota: 'gatilhos', rotulo: 'Rever as regras' },
    tranquilo: true,
  };
}
