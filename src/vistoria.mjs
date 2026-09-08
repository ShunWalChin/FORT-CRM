/**
 * Vistoria de entrada: o documento que separa o que já estava do que a oficina fez.
 *
 * Sem ela, todo arranhão encontrado na entrega vira discussão sem árbitro — e a
 * oficina perde as duas coisas, o cliente e a razão. Com ela, e com o aceite do
 * dono antes de a ordem andar, a conversa deixa de ser sobre memória.
 *
 * Três propriedades que fazem dela um instrumento e não um formulário:
 *
 *   1. **É guiada.** Cada item diz o que olhar (`dica`). Um checklist que só
 *      lista nomes é preenchido no automático, e um preenchido no automático
 *      não vale como prova — nem para o cliente, nem para a oficina.
 *
 *   2. **Crítico exige evidência.** Não se marca "vermelho" sem foto. É o que
 *      impede o laudo de virar opinião, e o que sustenta o orçamento que vem
 *      depois: o dono vê o pneu careca antes de ouvir o preço.
 *
 *   3. **O aceite é sobre um conteúdo específico.** `hashConteudo` resume o que
 *      foi aceito; mexer num item depois muda o resumo e a divergência aparece.
 *      Um aceite que vale para qualquer versão do documento não vale nada.
 *
 * Sobre a origem da lista: é uma vistoria profissional montada para oficina de
 * injeção diesel, e **não** a transcrição da folha oficial de nenhuma rede. Os
 * itens são dados (`CHECKLIST`), não código — trocar pela folha oficial da rede
 * é editar esta constante, sem tocar em regra nenhuma.
 */

import { createHash } from 'node:crypto';
import { agora } from './db.mjs';

/** Semáforo. `na` é o item que não existe naquele veículo — não é "não olhei". */
export const ESTADOS = {
  ok: { nome: 'Conforme', cor: 'ok', ordem: 0 },
  atencao: { nome: 'Atenção', cor: 'warn', ordem: 1 },
  critico: { nome: 'Crítico', cor: 'crit', ordem: 2 },
  na: { nome: 'Não se aplica', cor: '', ordem: 3 },
};

/**
 * Os itens, por sistema do veículo.
 *
 * `foto: 'sempre'` — registro obrigatório mesmo estando tudo certo (as quatro
 * faces do veículo, o hodômetro). São eles que provam o estado na entrada.
 * `foto: 'defeito'` — foto exigida quando o item não passa.
 * `medida` — o item pede número, com unidade e faixa saudável.
 */
export const CHECKLIST = [
  {
    grupo: 'Recepção',
    itens: [
      { chave: 'hodometro', nome: 'Hodômetro', dica: 'Fotografe o painel com o número legível. É a leitura que alimenta a previsão dos próximos serviços.', foto: 'sempre', medida: { unidade: 'km' } },
      { chave: 'combustivel', nome: 'Nível de combustível', dica: 'Anote o nível na entrada. Evita a pergunta "saiu com menos?" na devolução.', foto: 'sempre' },
      { chave: 'placa_chassi', nome: 'Placa e chassi', dica: 'Confira a placa contra o chassi gravado no monobloco. Divergência é assunto de documentação, não de oficina.', foto: 'sempre' },
      { chave: 'crlv', nome: 'CRLV em dia', dica: 'Documento vencido impede o teste de rodagem em via pública.', foto: 'defeito' },
      { chave: 'pertences', nome: 'Pertences no interior', dica: 'Registre o que fica no veículo. Ferramenta, carga e documento somem da memória, não do vídeo.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Exterior',
    itens: [
      { chave: 'frente', nome: 'Frente', dica: 'Enquadre o veículo inteiro, de frente, com a placa visível.', foto: 'sempre' },
      { chave: 'traseira', nome: 'Traseira', dica: 'Veículo inteiro, de trás. Inclua o para-choque.', foto: 'sempre' },
      { chave: 'lateral_esq', nome: 'Lateral esquerda', dica: 'De ponta a ponta. É onde aparecem amassados de corredor.', foto: 'sempre' },
      { chave: 'lateral_dir', nome: 'Lateral direita', dica: 'De ponta a ponta, como na esquerda. É o lado que encosta no meio-fio e junta risco de guia.', foto: 'sempre' },
      { chave: 'parabrisa', nome: 'Para-brisa e vidros', dica: 'Trinca no campo de visão do motorista reprova em vistoria. Fotografe de dentro, contra a luz.', foto: 'defeito' },
      { chave: 'retrovisores', nome: 'Retrovisores', dica: 'Inteiros, firmes e reguláveis.', foto: 'defeito' },
      { chave: 'iluminacao_ext', nome: 'Faróis, lanternas e setas', dica: 'Acenda tudo, incluindo a ré e o freio. Peça ajuda para conferir por trás.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Cabine',
    itens: [
      { chave: 'painel_luzes', nome: 'Luzes de advertência', dica: 'Dê partida e fotografe o painel. Luz de injeção acesa muda o orçamento inteiro.', foto: 'sempre' },
      { chave: 'cintos', nome: 'Cintos de segurança', dica: 'Puxe com força: o cinto tem de travar. Confira o enrolamento e a fivela.', foto: 'defeito' },
      { chave: 'bancos', nome: 'Bancos e travas', dica: 'Regulagem e travamento. Banco que corre no freio é risco.', foto: 'defeito' },
      { chave: 'buzina_limpador', nome: 'Buzina e limpador', dica: 'Palheta ressecada risca o para-brisa — informe antes de trocar.', foto: 'defeito' },
      { chave: 'ar_condicionado', nome: 'Ar-condicionado e ventilação', dica: 'Ligue no máximo por um minuto e sinta a saída.', foto: 'defeito' },
      { chave: 'extintor_triangulo', nome: 'Extintor e triângulo', dica: 'Itens obrigatórios; confira a validade do extintor.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Pneus e rodas',
    itens: [
      { chave: 'sulco_dianteiro', nome: 'Sulco dos pneus dianteiros', dica: 'Meça no ponto mais gasto. O mínimo legal é 1,6 mm — abaixo disso o veículo não pode rodar.', foto: 'defeito', medida: { unidade: 'mm', min: 1.6, alerta: 3 } },
      { chave: 'sulco_traseiro', nome: 'Sulco dos pneus traseiros', dica: 'Meça no ponto mais gasto de cada eixo.', foto: 'defeito', medida: { unidade: 'mm', min: 1.6, alerta: 3 } },
      { chave: 'desgaste_irregular', nome: 'Desgaste irregular', dica: 'Gasto só na borda é geometria; gasto no centro é calibragem alta. Fotografe a banda.', foto: 'defeito' },
      { chave: 'calibragem', nome: 'Calibragem', dica: 'Confira contra a etiqueta da coluna, com o pneu frio.', foto: 'defeito', medida: { unidade: 'psi' } },
      { chave: 'estepe', nome: 'Estepe e macaco', dica: 'Estepe calibrado e ferramenta completa. Ninguém descobre que falta no acostamento.', foto: 'defeito' },
      { chave: 'rodas', nome: 'Rodas e parafusos', dica: 'Trinca na roda e parafuso faltando são reprovação imediata.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Freios',
    itens: [
      { chave: 'pastilhas', nome: 'Pastilhas e lonas', dica: 'Meça a espessura do material de atrito. Abaixo de 3 mm, troque.', foto: 'defeito', medida: { unidade: 'mm', min: 2, alerta: 3 } },
      { chave: 'discos_tambores', nome: 'Discos e tambores', dica: 'Sulco profundo, borda alta ou empenamento. Passe a unha na face.', foto: 'defeito' },
      { chave: 'fluido_freio', nome: 'Fluido de freio', dica: 'Nível entre as marcas e cor clara. Fluido escuro absorveu água e ferve na descida.', foto: 'defeito' },
      { chave: 'vazamento_freio', nome: 'Vazamentos no sistema', dica: 'Olhe atrás de cada roda e ao longo das linhas. Qualquer umidade é crítico.', foto: 'defeito' },
      { chave: 'freio_estacionamento', nome: 'Freio de estacionamento', dica: 'Tem de segurar o veículo em rampa.', foto: 'defeito' },
      { chave: 'ar_freio', nome: 'Sistema pneumático (se houver)', dica: 'Tempo de enchimento e vazamento audível com o motor desligado.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Suspensão e direção',
    itens: [
      { chave: 'amortecedores', nome: 'Amortecedores', dica: 'Procure óleo escorrido na haste. Amortecedor vazando não amortece.', foto: 'defeito' },
      { chave: 'molas_feixes', nome: 'Molas e feixes', dica: 'Lâmina quebrada e mola cedida mudam a altura e comem pneu.', foto: 'defeito' },
      { chave: 'folga_direcao', nome: 'Folga na direção', dica: 'Com o veículo parado, gire o volante e sinta a folga morta.', foto: 'defeito' },
      { chave: 'terminais_coifas', nome: 'Terminais, pivôs e coifas', dica: 'Coifa rasgada deixa entrar água e barro: a peça morre em semanas.', foto: 'defeito' },
      { chave: 'alinhamento', nome: 'Alinhamento e balanceamento', dica: 'Veículo puxando para um lado ou volante tremendo em velocidade.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Motor',
    itens: [
      { chave: 'oleo_nivel', nome: 'Nível e aspecto do óleo', dica: 'Óleo leitoso é água na câmara — pare o serviço e avise. Fotografe a vareta.', foto: 'sempre' },
      { chave: 'vazamentos_motor', nome: 'Vazamentos', dica: 'Olhe o cárter, a tampa de válvulas e o retentor. Fotografe a poça, se houver.', foto: 'defeito' },
      { chave: 'correias', nome: 'Correias e tensores', dica: 'Trinca transversal, brilho de patinação e ruído no tensor.', foto: 'defeito' },
      { chave: 'mangueiras', nome: 'Mangueiras e abraçadeiras', dica: 'Aperte com a mão: mangueira boa volta, mangueira velha fica marcada.', foto: 'defeito' },
      { chave: 'coxins', nome: 'Coxins e fixações', dica: 'Motor batendo na carroceria em aceleração.', foto: 'defeito' },
      { chave: 'partida_frio', nome: 'Partida a frio', dica: 'Conte os segundos até pegar e observe a fumaça inicial.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Arrefecimento',
    itens: [
      { chave: 'liquido_nivel', nome: 'Nível do líquido', dica: 'Com o motor FRIO. Abrir quente queima.', foto: 'defeito' },
      { chave: 'liquido_aspecto', nome: 'Aspecto do aditivo', dica: 'Ferrugem ou óleo boiando indicam problema sério. Fotografe o reservatório.', foto: 'defeito' },
      { chave: 'radiador', nome: 'Radiador e colmeia', dica: 'Colmeia entupida de barro e inseto derruba a troca de calor.', foto: 'defeito' },
      { chave: 'ventoinha', nome: 'Ventoinha e embreagem viscosa', dica: 'Aciona na temperatura certa?', foto: 'defeito' },
      { chave: 'vazamento_arref', nome: 'Vazamentos', dica: 'Crosta esbranquiçada denuncia vazamento antigo.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Injeção diesel',
    itens: [
      { chave: 'filtro_combustivel', nome: 'Filtro de combustível', dica: 'Confira a data da última troca. Filtro saturado mata bomba de alta.', foto: 'defeito' },
      { chave: 'separador_agua', nome: 'Separador de água', dica: 'Drene e fotografe o que sair. Água no diesel é a causa número um de bomba queimada.', foto: 'sempre' },
      { chave: 'tubulacoes', nome: 'Tubulações e conexões', dica: 'Umidade de diesel em conexão é entrada de ar no sistema.', foto: 'defeito' },
      { chave: 'retorno_bicos', nome: 'Retorno dos bicos', dica: 'Retorno excessivo num cilindro isola o bico com defeito antes de desmontar.', foto: 'defeito', medida: { unidade: 'ml/min' } },
      { chave: 'pressao_rail', nome: 'Pressão de rail', dica: 'Leia no scanner em marcha lenta e em aceleração. Fora da faixa é bomba ou regulador.', foto: 'defeito', medida: { unidade: 'bar' } },
      { chave: 'fumaca', nome: 'Fumaça de escape', dica: 'Preta é excesso de combustível, azul é óleo, branca é água. Grave um vídeo curto acelerando.', foto: 'defeito' },
      { chave: 'codigos_falha', nome: 'Códigos de falha', dica: 'Leia com o scanner ANTES de mexer. Apagar sem anotar perde a pista.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Elétrica',
    itens: [
      { chave: 'bateria', nome: 'Bateria', dica: 'Meça a tensão em repouso. Abaixo de 12,4 V está descarregada; abaixo de 12,0 V, sulfatada.', foto: 'defeito', medida: { unidade: 'V', min: 12.0, alerta: 12.4 } },
      { chave: 'terminais_bateria', nome: 'Terminais e cabos', dica: 'Zinabre e terminal frouxo derrubam a partida e enganam o diagnóstico.', foto: 'defeito' },
      { chave: 'alternador', nome: 'Carga do alternador', dica: 'Com o motor em marcha, a tensão deve subir para 13,8–14,4 V.', foto: 'defeito', medida: { unidade: 'V', min: 13.5, alerta: 13.8 } },
      { chave: 'motor_partida', nome: 'Motor de partida', dica: 'Giro lento com bateria boa é o próprio motor de partida.', foto: 'defeito' },
      { chave: 'chicotes', nome: 'Chicotes e emendas', dica: 'Emenda com fita isolante perto do escape é começo de incêndio.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Teste de rodagem',
    itens: [
      { chave: 'ruidos', nome: 'Ruídos anormais', dica: 'Janela aberta, rádio desligado. Passe em lombada e em piso irregular.', foto: 'defeito' },
      { chave: 'pedal_freio', nome: 'Resposta do freio', dica: 'Pedal baixo, esponjoso ou puxando para um lado.', foto: 'defeito' },
      { chave: 'temperatura', nome: 'Temperatura em operação', dica: 'Acompanhe o ponteiro depois de dez minutos rodando.', foto: 'defeito' },
      { chave: 'cambio_embreagem', nome: 'Câmbio e embreagem', dica: 'Ponto de embreagem alto e dificuldade de engate.', foto: 'defeito' },
      { chave: 'desempenho', nome: 'Desempenho e resposta', dica: 'Falha de aceleração, engasgo em carga e perda de força em subida.', foto: 'defeito' },
    ],
  },
];

/** Todos os itens numa lista só, já com o grupo e a posição. */
export function itensDoChecklist() {
  const saida = [];
  let pos = 0;
  for (const g of CHECKLIST) {
    for (const i of g.itens) {
      saida.push({ ...i, grupo: g.grupo, posicao: pos });
      pos += 1;
    }
  }
  return saida;
}

export const TOTAL_ITENS = itensDoChecklist().length;

/** O item exige foto no estado em que foi marcado? */
export function exigeFoto(item, estado) {
  if (item.foto === 'sempre') return estado !== 'na';
  if (item.foto === 'defeito') return estado === 'critico' || estado === 'atencao';
  return false;
}

/**
 * O que falta para esta vistoria poder ir ao cliente.
 *
 * Devolve a lista de pendências, e não um booleano: "não pode enviar" sem dizer
 * o que falta obriga a pessoa a caçar o item numa lista de sessenta.
 */
export function pendencias(itens, midiasPorItem = {}) {
  const catalogo = new Map(itensDoChecklist().map((i) => [i.chave, i]));
  const faltas = [];

  for (const [chave, def] of catalogo) {
    const marcado = itens.find((i) => i.chave === chave);
    if (!marcado || !marcado.estado) {
      faltas.push({ chave, nome: def.nome, grupo: def.grupo, falta: 'nao_avaliado' });
      continue;
    }
    if (exigeFoto(def, marcado.estado) && !(midiasPorItem[marcado.id]?.length)) {
      faltas.push({
        chave,
        nome: def.nome,
        grupo: def.grupo,
        falta: marcado.estado === 'critico' || marcado.estado === 'atencao'
          ? 'foto_do_defeito'
          : 'foto_obrigatoria',
      });
    }
  }
  return faltas;
}

/**
 * Resumo do que foi aceito.
 *
 * Entram o veículo, o km, e cada item com estado, medida e a impressão digital
 * das mídias. Não entram data de criação nem quem digitou: o cliente aceita o
 * ESTADO DO VEÍCULO, e a vistoria continuar a mesma depois de o técnico
 * corrigir a própria grafia numa nota é o comportamento certo.
 */
export function hashConteudo(vistoria, itens, midias = []) {
  const midiasPor = new Map();
  for (const m of midias) {
    const lista = midiasPor.get(m.item_id) ?? [];
    lista.push(m.sha256 ?? m.arquivo);
    midiasPor.set(m.item_id, lista);
  }

  const corpo = {
    veiculo: vistoria.veiculo_id,
    km: vistoria.km ?? null,
    combustivel: vistoria.nivel_combustivel ?? null,
    itens: [...itens]
      .sort((a, b) => a.chave.localeCompare(b.chave))
      .map((i) => ({
        chave: i.chave,
        estado: i.estado ?? null,
        medida: i.medida ?? null,
        nota: i.nota ?? null,
        midias: (midiasPor.get(i.id) ?? []).sort(),
      })),
  };
  return createHash('sha256').update(JSON.stringify(corpo)).digest('hex');
}

/**
 * A ordem de serviço só anda com vistoria aceita.
 *
 * É a regra que dá sentido a tudo acima: sem ela a vistoria vira papel que se
 * preenche depois, para constar. Devolve o motivo, porque a tela precisa dizer
 * o que fazer — e o que fazer é diferente em cada caso.
 */
export function podeIniciarOS(vistoria) {
  if (!vistoria) {
    return { pode: false, motivo: 'sem_vistoria', texto: 'Esta ordem não tem vistoria de entrada. Faça a vistoria antes de começar o serviço.' };
  }
  if (vistoria.status === 'aceita') return { pode: true };
  if (vistoria.status === 'rascunho') {
    return { pode: false, motivo: 'em_andamento', texto: 'A vistoria ainda está em preenchimento. Conclua e envie para o cliente aceitar.' };
  }
  if (vistoria.status === 'aguardando_aceite') {
    return { pode: false, motivo: 'sem_aceite', texto: 'A vistoria foi enviada e o cliente ainda não aceitou. O serviço começa depois do aceite.' };
  }
  if (vistoria.status === 'recusada') {
    return { pode: false, motivo: 'recusada', texto: `O cliente recusou a vistoria${vistoria.recusa_motivo ? `: ${vistoria.recusa_motivo}` : '.'} Refaça a vistoria ou converse com ele antes de seguir.` };
  }
  return { pode: false, motivo: 'cancelada', texto: 'Esta vistoria foi cancelada. Faça uma nova.' };
}

/** Contagem por estado, para o resumo da tela e do laudo. */
export function resumo(itens) {
  const r = { ok: 0, atencao: 0, critico: 0, na: 0, pendente: 0, total: TOTAL_ITENS };
  for (const i of itens) {
    if (!i.estado) r.pendente += 1;
    else r[i.estado] = (r[i.estado] ?? 0) + 1;
  }
  r.pendente = TOTAL_ITENS - itens.filter((i) => i.estado).length;
  r.avaliados = TOTAL_ITENS - r.pendente;
  r.percentual = Math.round((r.avaliados / TOTAL_ITENS) * 100);
  return r;
}

/** Número legível da vistoria: VT-00042. */
export function proximoNumero(escopo) {
  const ultima = escopo.uma(
    "select numero from vistorias where {ESCOPO} and numero like 'VT-%' order by numero desc limit 1",
  );
  const n = ultima ? Number(String(ultima.numero).slice(3)) + 1 : 1;
  return `VT-${String(n).padStart(5, '0')}`;
}

export { agora };
