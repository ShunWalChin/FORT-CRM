/**
 * Oficina: vida do veículo e o app de vistoria.
 *
 * Só existe na Minas Peças — é a instância que tem elevador. As telas são
 * registradas condicionalmente em `app.js`, e o servidor recusa as rotas para
 * quem não tem o veículo no escopo.
 *
 * A vistoria é desenhada para o CELULAR primeiro, e não adaptada depois: ela é
 * feita em pé, ao lado do carro, com uma mão segurando o telefone e a outra na
 * lanterna. Isso decide quase tudo aqui — um grupo por vez em vez de sessenta e
 * três itens numa lista, botões de estado do tamanho do polegar, e a câmera a
 * um toque de distância do item que está sendo avaliado.
 */

import { criarFila } from './fila.js';
import { CAIXA, ORDEM_VISTAS, VISTAS } from './carroceria.js';

const LADO_MAXIMO = 1600;
const QUALIDADE = 0.82;

/** Tipos de avaria, com a letra que vai dentro do pino. */
const TIPOS_AVARIA = [
  { valor: 'risco', nome: 'Risco', letra: 'R' },
  { valor: 'amassado', nome: 'Amassado', letra: 'A' },
  { valor: 'trinca', nome: 'Trinca', letra: 'T' },
  { valor: 'ferrugem', nome: 'Ferrugem', letra: 'F' },
  { valor: 'faltando', nome: 'Faltando', letra: 'X' },
  { valor: 'outro', nome: 'Outro', letra: 'O' },
];

const PAGAMENTOS = [
  { valor: 'dinheiro', nome: 'Dinheiro' },
  { valor: 'pix', nome: 'PIX' },
  { valor: 'debito', nome: 'Cartão de débito' },
  { valor: 'credito', nome: 'Cartão de crédito' },
  { valor: 'boleto', nome: 'Boleto' },
  { valor: 'faturado', nome: 'Faturado' },
];

/** "1.650,00" vira 165000. O teclado do celular manda vírgula, e não ponto. */
function emCentavos(texto) {
  const limpo = String(texto ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) && limpo !== '' ? Math.round(n * 100) : null;
}

const emReais = (c) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));

/**
 * Reduz a foto ANTES de subir.
 *
 * Um celular atual produz 4 a 8 MB por foto. Sessenta e três itens com foto
 * seriam 300 MB por vistoria, numa oficina que provavelmente está no 4G do
 * telefone do técnico. A 1600 px de lado maior e qualidade 0,82 a mesma foto
 * fica em 200–400 KB e continua mostrando trinca em disco e sulco de pneu —
 * que é para o que ela serve.
 *
 * Feito no navegador, e não no servidor: subir 8 MB para reduzir depois gasta
 * exatamente a parte cara, que é a rede do técnico.
 */
async function reduzirFoto(arquivo) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const l = Math.round(bitmap.width * escala);
  const a = Math.round(bitmap.height * escala);

  const tela = document.createElement('canvas');
  tela.width = l;
  tela.height = a;
  tela.getContext('2d').drawImage(bitmap, 0, 0, l, a);
  bitmap.close?.();

  const blob = await new Promise((r) => tela.toBlob(r, 'image/jpeg', QUALIDADE));
  return { blob, largura: l, altura: a };
}

const ESTADO_BOTOES = [
  { valor: 'ok', rotulo: 'Conforme', classe: 'ok' },
  { valor: 'atencao', rotulo: 'Atenção', classe: 'warn' },
  { valor: 'critico', rotulo: 'Crítico', classe: 'crit' },
  { valor: 'na', rotulo: 'N/A', classe: 'na' },
];

/*
 * A mídia é carregada por `fetch`, e não por `src` direto.
 *
 * `<img src="/api/midia/…">` não envia o cabeçalho de autorização — a tag não
 * tem como. O resultado era 401 e miniatura quebrada em toda a vistoria, com o
 * texto alternativo vazando por cima do desenho.
 *
 * A saída óbvia seria aceitar o token na query, como o laudo já faz. Aqui não:
 * o laudo é UM link aberto em aba nova, e estas são até sessenta imagens numa
 * página só — o token entraria sessenta vezes no histórico do navegador e em
 * qualquer log de proxy pelo caminho. Foto de vistoria é documento de um
 * cliente; o token fica no cabeçalho.
 *
 * O `blob:` criado é revogado quando o elemento sai da tela, senão cada
 * re-render da vistoria vazaria dezenas de megabytes na aba.
 */
async function carregarMidias(raiz, ui) {
  for (const el of raiz.querySelectorAll('[data-midia]:not([data-carregada])')) {
    el.dataset.carregada = '1';
    try {
      const r = await fetch(`/api/midia/${el.dataset.midia}`, {
        headers: { authorization: `Bearer ${ui.token()}`, 'x-instancia': ui.instancia() },
      });
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      el.src = url;
      el.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    } catch {
      // Arquivo sumiu do disco: o registro continua, e a tela diz isso em vez
      // de mostrar um quadrado quebrado sem explicação.
      el.replaceWith(Object.assign(document.createElement('div'), {
        className: 'vt-foto-sumiu',
        textContent: 'arquivo indisponível',
      }));
    }
  }
}

/* ══ Vistorias: lista e abertura ═══════════════════════════════════════════ */

export function telaVistorias(ui) {
  return async (el) => {
    const lista = await ui.api('/vistorias');
    const { esc, data } = ui;

    const cor = {
      rascunho: 'warn', aguardando_aceite: 'ac', aceita: 'ok', recusada: 'crit', cancelada: '',
    };
    const rotulo = {
      rascunho: 'em preenchimento', aguardando_aceite: 'aguardando o cliente',
      aceita: 'aceita', recusada: 'recusada', cancelada: 'cancelada',
    };

    el.innerHTML = `
      <div class="cabeca">
        <div>
          <div class="kicker">// SEGURANÇA</div>
          <h1 class="titulo">Vistorias de entrada</h1>
          <p class="chamada">
            A vistoria separa o que já estava no veículo do que a oficina fez. Sem ela, todo
            arranhão encontrado na entrega vira discussão sem árbitro. <strong>A ordem de serviço
            só começa depois que o dono aceita o estado registrado.</strong>
          </p>
        </div>
        <button class="btn" id="nova-vistoria">Nova vistoria</button>
      </div>

      ${lista.length ? `<div class="tabela-caixa"><table>
        <thead><tr><th>Vistoria</th><th>Veículo</th><th>Cliente</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((v) => `
          <tr>
            <td class="forte" style="font-family:var(--mono)">${esc(v.numero)}
              <div class="fraco">${data(v.iniciada_em)}</div></td>
            <td style="font-family:var(--mono)">${esc(v.placa)}
              <div class="fraco">${esc([v.marca, v.modelo].filter(Boolean).join(' '))}</div></td>
            <td>${esc(v.cliente_nome)}</td>
            <td><span class="tag ${cor[v.status] ?? ''}">${esc(rotulo[v.status] ?? v.status)}</span></td>
            <td><button class="btn quiet sm" data-abrir="${esc(v.id)}">
              ${v.status === 'rascunho' ? 'Continuar' : 'Ver'}</button></td>
          </tr>`).join('')}
        </tbody></table></div>`
    : `<div class="vazio">
         <h3>Nenhuma vistoria ainda</h3>
         <p>A vistoria é feita com o veículo na entrada, antes de abrir a ordem de serviço.
            São 63 itens, guiados, com foto — leva de dez a quinze minutos.</p>
       </div>`}`;

    el.querySelectorAll('[data-abrir]').forEach((b) => {
      b.onclick = () => { location.hash = `#/vistoria?id=${b.dataset.abrir}`; };
    });
    el.querySelector('#nova-vistoria').onclick = () => abrirNova(ui);
  };
}

async function abrirNova(ui) {
  const veiculos = await ui.api('/veiculos');
  if (!veiculos.length) {
    ui.toast('Nenhum veículo cadastrado', 'Cadastre o veículo na ficha do cliente primeiro.', 'erro');
    return;
  }
  const cat = await ui.api('/checklist');
  const t = cat.tamanhos;
  const r = await ui.perguntar({
    titulo: 'Abrir vistoria de entrada',
    texto: 'Escolha o veículo e a profundidade da revisão. Os itens são criados agora e '
      + 'ficam gravados — mudar o catálogo depois não muda esta vistoria.',
    campos: [
      {
        nome: 'veiculo', rotulo: 'Veículo', tipo: 'selecao', obrigatorio: true,
        opcoes: veiculos.map((v) => ({
          valor: v.id,
          rotulo: `${v.placa} — ${[v.marca, v.modelo].filter(Boolean).join(' ')} · ${v.cliente_nome ?? ''}`,
        })),
      },
      {
        nome: 'nivel', rotulo: 'Revisão', tipo: 'selecao',
        opcoes: [
          { valor: 'bronze', rotulo: `Bronze — essencial · ${t.bronze} itens` },
          { valor: 'prata', rotulo: `Prata — completa · ${t.prata} itens` },
          { valor: 'ouro', rotulo: `Ouro — maior · ${t.ouro} itens` },
        ],
        ajuda: 'Bronze é segurança e fluidos. Prata acrescenta filtros, suspensão sob elevador e '
          + 'teste de rodagem. Ouro acrescenta câmbio, diferencial, chassi e diagnóstico completo.',
      },
    ],
    confirmar: 'Abrir vistoria',
  });
  if (!r) return;
  try {
    const v = await ui.api('/vistorias', {
      method: 'POST',
      corpo: { veiculo_id: r.veiculo, nivel: r.nivel ?? 'prata' },
    });
    ui.toast(`Vistoria ${v.numero} aberta`,
      `Revisão ${v.nivel} · ${v.itens} itens. Comece pela recepção, com o cliente ao lado.`);
    location.hash = `#/vistoria?id=${v.id}`;
  } catch (e) {
    ui.toast('Não deu para abrir', e.message, 'erro');
  }
}

/* ══ O app de vistoria ═════════════════════════════════════════════════════ */

export function telaVistoria(ui) {
  return async (el) => {
    const id = new URLSearchParams(location.hash.split('?')[1] ?? '').get('id');
    if (!id) { location.hash = '#/vistorias'; return; }

    const d = await ui.api(`/vistorias/${id}`);
    const { esc } = ui;
    const v = d.vistoria;
    const soLeitura = v.status !== 'rascunho';

    /*
     * Duas abas vêm ANTES do check-list, porque é essa a ordem do balcão: o
     * cliente chega, diz o que quer, e a volta ao redor do carro é feita com
     * ele do lado. Só depois o veículo sobe no elevador.
     */
    const ABA_PEDIDO = '@pedido';
    const ABA_CARROCERIA = '@carroceria';
    const abas = [
      { chave: ABA_PEDIDO, rotulo: 'Pedido e entrega' },
      { chave: ABA_CARROCERIA, rotulo: 'Carroceria' },
      ...d.catalogo.map((g) => ({ chave: g.grupo, rotulo: g.grupo })),
    ];

    const pendentePorGrupo = {};
    for (const p of d.pendencias) pendentePorGrupo[p.grupo] = (pendentePorGrupo[p.grupo] ?? 0) + 1;

    let atual = sessionStorage.getItem(`vist.${id}.grupo`);
    if (!abas.some((a) => a.chave === atual)) {
      atual = d.catalogo.map((g) => g.grupo).find((g) => pendentePorGrupo[g]) ?? ABA_PEDIDO;
    }

    // Estado só da tela: qual vista da carroceria está aberta, e que tipo de
    // avaria o próximo toque vai marcar.
    let vista = ORDEM_VISTAS[0];
    let tipoAvaria = 'risco';
    let avariaAberta = null;

    /*
     * O envio das marcações passa por uma fila.
     *
     * São 86 toques feitos em pé ao lado do elevador, onde o sinal cai atrás da
     * coluna e volta na porta. Sem fila, cada toque dependia da rede naquele
     * segundo — e o técnico não tem como saber, meia hora depois, em quais
     * itens o aviso vermelho apareceu.
     *
     * Só as MARCAÇÕES entram na fila. Avaria e serviço são criados no servidor
     * (o id vem de lá) e ficam com envio direto: são poucos, feitos no balcão,
     * e uma fila com id provisório para reconciliar depois seria máquina demais
     * para o problema.
     */
    const fila = criarFila({
      enviar: async (t) => {
        const r = await fetch(`/api${t.caminho}`, {
          method: t.metodo,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${ui.token()}`,
            'x-instancia': ui.instancia(),
          },
          body: t.corpo ? JSON.stringify(t.corpo) : undefined,
        });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j.ok) {
          const e = new Error(j.erro?.mensagem ?? `Falha ${r.status}`);
          e.status = r.status;
          throw e;
        }
        // O servidor é quem sabe o que ainda falta: a tela adianta a cor do
        // item, mas a lista de pendências vem de quem tem a regra.
        if (t.vistoria === id && j.dados?.pendencias) {
          d.pendencias = j.dados.pendencias;
          d.resumo = j.dados.resumo ?? d.resumo;
          recontarGrupos();
          // Só o item que subiu muda de pendência — repintar a tela inteira
          // aqui desfaria a rolagem do técnico enquanto ele já está no próximo.
          pintarItem(String(t.chave).split(':').pop());
          pintarResumo();
          pintarAbas();
        }
      },
      aoMudar: (e) => pintarFila(e),
    });

    const recontarGrupos = () => {
      for (const k of Object.keys(pendentePorGrupo)) delete pendentePorGrupo[k];
      for (const p of d.pendencias) pendentePorGrupo[p.grupo] = (pendentePorGrupo[p.grupo] ?? 0) + 1;
    };

    /*
     * A barra de estado da fila é pintada FORA do `desenhar()`.
     *
     * Redesenhar a tela inteira a cada mudança da fila fecharia o teclado no
     * meio de uma observação e perderia a rolagem — a cada dois segundos,
     * durante uma vistoria de quarenta minutos.
     */
    const pintarFila = (e) => {
      const barra = el.querySelector('#vt-fila');
      if (!barra) return;
      if (!e.pendentes && !e.erro) { barra.hidden = true; return; }
      barra.hidden = false;
      barra.className = `vt-fila ${e.online ? (e.enviando ? 'enviando' : 'espera') : 'offline'}`;
      barra.innerHTML = !e.online
        ? `<span>Sem rede — <b>${e.pendentes}</b> marcação(ões) guardada(s) no aparelho.</span>`
        : e.enviando
          ? `<span>Salvando <b>${e.pendentes}</b>…</span>`
          : `<span><b>${e.pendentes}</b> por salvar${e.erro ? `: ${esc(e.erro)}` : ''}</span>
             <button class="btn quiet sm" id="vt-fila-tentar">Tentar de novo</button>`;
      barra.querySelector('#vt-fila-tentar')?.addEventListener('click', () => fila.empurrar());
    };

    const desenhar = () => {
      const r = d.resumo;
      el.innerHTML = `
        <div class="vistoria-topo">
          <div class="vt-linha">
            <a class="btn quiet sm" href="#/vistorias">‹ Vistorias</a>
            <span class="vt-num">${esc(v.numero)}</span>
            <span class="vt-nivel ${esc(v.nivel ?? 'prata')}">${esc(d.niveis?.[v.nivel]?.nome ?? 'Prata')}</span>
            <span class="tag ${soLeitura ? 'ok' : 'warn'}">${esc(v.status.replaceAll('_', ' '))}</span>
          </div>
          <div class="vt-veiculo">
            <b style="font-family:var(--mono)">${esc(v.placa)}</b>
            ${esc([v.marca, v.modelo, v.ano].filter(Boolean).join(' '))}
            <div class="fraco">${esc(v.cliente_nome)}</div>
          </div>
          <div class="vt-progresso" role="progressbar" aria-valuenow="${r.percentual}" aria-valuemin="0" aria-valuemax="100">
            <div class="vt-barra" style="width:${r.percentual}%"></div>
          </div>
          <div class="vt-fila" id="vt-fila" hidden></div>
          <div class="vt-conta">
            <span><b>${r.avaliados}</b> de ${r.total}</span>
            ${r.critico ? `<span class="tag crit">${r.critico} crítico${r.critico > 1 ? 's' : ''}</span>` : ''}
            ${r.atencao ? `<span class="tag warn">${r.atencao} atenção</span>` : ''}
            ${r.ok ? `<span class="tag ok">${r.ok} conforme</span>` : ''}
          </div>
        </div>

        <button class="vt-grupo-atual" id="vt-abrir-grupos" aria-haspopup="dialog">
          <span class="vt-grupo-onde">
            Grupo ${abas.findIndex((a) => a.chave === atual) + 1} de ${abas.length}
          </span>
          <b>${esc(abas.find((a) => a.chave === atual)?.rotulo ?? '')}</b>
          ${pendentePorGrupo[atual] ? `<span class="vt-falta">${pendentePorGrupo[atual]}</span>` : ''}
          <span class="vt-grupo-seta" aria-hidden="true">▾</span>
        </button>

        <div class="vt-grupos" id="vt-grupos">
          ${abas.map((a) => {
    const marca = a.chave === ABA_PEDIDO ? (d.servicos ?? []).length
      : a.chave === ABA_CARROCERIA ? (d.avarias ?? []).length
        : pendentePorGrupo[a.chave] ?? 0;
    const classe = a.chave.startsWith('@') ? 'conta' : 'vt-falta';
    return `
            <button class="vt-aba ${a.chave === atual ? 'on' : ''} ${a.chave.startsWith('@') ? 'extra' : ''}"
                    data-grupo="${esc(a.chave)}">
              ${esc(a.rotulo)}
              ${marca ? `<span class="vt-falta ${classe}">${marca}</span>` : ''}
            </button>`;
  }).join('')}
        </div>

        <div id="vt-itens">${conteudoAba(atual)}</div>
        <div class="vt-fim" id="vt-fim" hidden></div>

        ${soLeitura ? painelFechado(v, d, esc) : `
          <div class="vt-rodape">
            ${d.pendencias.length
    ? `<div class="vt-pendente"><b>${d.pendencias.length}</b> item(ns) faltando —
         <button class="btn quiet sm" id="ir-pendente">ver o primeiro</button></div>`
    : '<div class="vt-pronto">Tudo preenchido. Pode enviar para o cliente.</div>'}
            <button class="btn" id="concluir" ${d.pendencias.length ? 'disabled' : ''}>
              Concluir e enviar ao cliente
            </button>
          </div>`}`;

      ligar();
      pintarFila(fila.estado());
      carregarMidias(el, ui);
    };

    const conteudoAba = (nome) => {
      if (nome === ABA_PEDIDO) return desenharPedido();
      if (nome === ABA_CARROCERIA) return desenharCarroceria();
      return desenharGrupo(nome);
    };

    const desenharGrupo = (nome) => {
      const g = d.catalogo.find((x) => x.grupo === nome);
      if (!g) return '';
      /*
       * A posição do veículo abre o grupo.
       *
       * Os grupos são a ordem do TRABALHO, e não a dos sistemas: o técnico não
       * pula do freio dianteiro para o motor e volta ao traseiro. Dizer onde o
       * carro tem de estar é o que torna a sequência utilizável.
       */
      const cabeca = g.posicao ? `
        <div class="vt-posicao">
          <b>${esc(g.posicao)}</b>
          ${g.dica ? `<span>${esc(g.dica)}</span>` : ''}
        </div>` : '';
      return cabeca + g.itens.map((def) => {
        const item = d.itens.find((i) => i.chave === def.chave) ?? {};
        const midias = d.midias[item.id] ?? [];
        const precisa = d.pendencias.find((p) => p.chave === def.chave);
        return `
          <div class="vt-item ${item.estado ? `marcado ${item.estado}` : ''} ${precisa ? 'falta' : ''}"
               data-chave="${esc(def.chave)}">
            <div class="vt-item-topo">
              <h3>${esc(def.nome)}</h3>
              ${def.foto === 'sempre' ? '<span class="vt-sel">foto obrigatória</span>' : ''}
            </div>
            <p class="vt-dica">${esc(def.dica)}</p>

            <div class="vt-estados">
              ${ESTADO_BOTOES.map((b) => `
                <button class="vt-estado ${b.classe} ${item.estado === b.valor ? 'on' : ''}"
                        data-estado="${b.valor}" ${soLeitura ? 'disabled' : ''}>${b.rotulo}</button>`).join('')}
            </div>

            ${def.medida ? `
              <label class="vt-medida">
                <span>${esc(def.medida.unidade)}</span>
                <input type="text" inputmode="decimal" data-medida
                       value="${item.medida ?? ''}" ${soLeitura ? 'disabled' : ''}
                       placeholder="${def.medida.min != null ? `mínimo ${def.medida.min}` : 'medida'}">
              </label>` : ''}

            ${(() => {
    /*
     * A câmera e a observação só ocupam espaço quando têm o que mostrar.
     *
     * Medido: o cartão tinha 394 px de mediana num celular com 645 px úteis —
     * 1,64 item por tela. Desses 394, a fileira da câmera gastava 76 px e o
     * campo de observação vazio gastava 44, em TODOS os 86 itens, para algo
     * usado em talvez quinze. Aberto por padrão só onde a foto é exigida ou já
     * existe; nos outros vira um par de fichas de 34 px.
     */
    const exigeAgora = def.foto === 'sempre'
      || (def.foto === 'defeito' && (item.estado === 'critico' || item.estado === 'atencao'));
    const aberto = midias.length > 0 || exigeAgora;
    const galeria = midias.map((m) => `
                <div class="vt-foto">
                  ${m.tipo === 'video'
    ? `<video data-midia="${esc(m.id)}" controls playsinline preload="metadata"></video>`
    : `<img data-midia="${esc(m.id)}" alt="${esc(def.nome)}">`}
                  ${soLeitura ? '' : `<button class="vt-tirar" data-apagar="${esc(m.id)}" aria-label="Apagar">×</button>`}
                </div>`).join('');

    if (soLeitura) {
      return (galeria ? `<div class="vt-midias">${galeria}</div>` : '')
        + (item.nota ? `<div class="vt-nota-lida">${esc(item.nota)}</div>` : '');
    }

    const camera = `
                <label class="vt-camera">
                  <input type="file" accept="image/*" capture="environment" hidden data-foto>
                  <span>+ Foto</span>
                </label>
                <label class="vt-camera video">
                  <input type="file" accept="video/*" capture="environment" hidden data-video>
                  <span>+ Vídeo</span>
                </label>`;

    const nota = `<input class="vt-nota" type="text" data-nota
                     placeholder="Observação (opcional)" value="${esc(item.nota ?? '')}">`;

    return `
            <div class="vt-midias" ${aberto ? '' : 'hidden'}>${galeria}${camera}</div>
            ${item.nota ? nota : ''}
            <div class="vt-fichas">
              ${aberto ? '' : '<button class="vt-ficha" data-abrir="midia">+ Foto ou vídeo</button>'}
              ${item.nota ? '' : '<button class="vt-ficha" data-abrir="nota">+ Observação</button>'}
            </div>`;
  })()}
            ${precisa ? `<div class="vt-aviso">${precisa.falta === 'nao_avaliado'
    ? 'Falta avaliar este item.'
    : precisa.falta === 'foto_do_defeito'
      ? 'Item fora do conforme exige foto — é ela que sustenta o orçamento.'
      : 'Este item exige foto mesmo estando tudo certo.'}</div>` : ''}
          </div>`;
      }).join('');
    };

    /* ── Carroceria: o desenho que responde "como estava?" ──────────────── */

    const tipoDe = (t) => TIPOS_AVARIA.find((x) => x.valor === t) ?? { nome: t, letra: '?' };

    const desenharCarroceria = () => {
      const todas = d.avarias ?? [];
      // A numeração é global e por ordem de marcação, como na folha de papel:
      // "avaria 3" tem de ser a mesma no desenho e na lista embaixo.
      const numero = new Map(todas.map((a, i) => [a.id, i + 1]));
      const daVista = todas.filter((a) => a.vista === vista);
      const aberta = todas.find((a) => a.id === avariaAberta);

      return `
        <div class="cr">
          <div class="vt-posicao">
            <b>Como o veículo chegou</b>
            <span>Dê a volta no carro com o cliente ao lado e toque onde houver marca.
                  É este desenho que responde ao “esse risco já estava?” na entrega.</span>
          </div>

          <div class="cr-vistas" role="tablist">
            ${ORDEM_VISTAS.map((v) => {
    const n = todas.filter((a) => a.vista === v).length;
    return `<button class="cr-vista ${v === vista ? 'on' : ''}" data-vista="${v}"
                        role="tab" aria-selected="${v === vista}">
                      ${esc(VISTAS[v].rotulo)}${n ? `<span class="cr-conta">${n}</span>` : ''}
                    </button>`;
  }).join('')}
          </div>

          ${soLeitura ? '' : `
            <div class="cr-tipos">
              ${TIPOS_AVARIA.map((t) => `
                <button class="cr-tipo ${t.valor} ${t.valor === tipoAvaria ? 'on' : ''}"
                        data-tipo="${t.valor}" aria-pressed="${t.valor === tipoAvaria}">
                  <span class="cr-letra">${t.letra}</span>${esc(t.nome)}
                </button>`).join('')}
            </div>`}

          <div class="cr-tela">
            <svg viewBox="0 0 ${CAIXA.largura} ${CAIXA.altura}" id="cr-svg"
                 class="cr-svg ${soLeitura ? 'travado' : ''}" role="img"
                 aria-label="Carroceria, ${esc(VISTAS[vista].rotulo)}, ${daVista.length} marca(s)">
              ${VISTAS[vista].desenho}
              ${daVista.map((a) => `
                <g class="cr-pino ${esc(a.tipo)} ${a.id === avariaAberta ? 'on' : ''}"
                   data-avaria="${esc(a.id)}"
                   transform="translate(${(a.x * CAIXA.largura).toFixed(2)} ${(a.y * CAIXA.altura).toFixed(2)})">
                  <circle class="cr-toque" r="14"/>
                  <circle class="cr-bola" r="8.5"/>
                  <text y="3.2">${numero.get(a.id)}</text>
                </g>`).join('')}
            </svg>
            ${soLeitura ? '' : `
              <div class="cr-ajuda">
                Toque no desenho para marcar <b>${esc(tipoDe(tipoAvaria).nome).toLowerCase()}</b>
              </div>`}
          </div>

          ${aberta ? `
            <div class="cr-aberta ${esc(aberta.tipo)}">
              <div class="cr-aberta-topo">
                <span class="cr-selo">${numero.get(aberta.id)}</span>
                <b>${esc(tipoDe(aberta.tipo).nome)}</b>
                <span class="fraco">${esc(VISTAS[aberta.vista]?.rotulo ?? aberta.vista)}</span>
                <button class="btn quiet sm" id="cr-fechar">Fechar</button>
              </div>
              <input class="vt-nota" type="text" id="cr-nota" maxlength="200"
                     placeholder="Descreva a marca (opcional) — ex.: 15 cm, porta dianteira"
                     value="${esc(aberta.nota ?? '')}" ${soLeitura ? 'disabled' : ''}>
              ${soLeitura ? '' : '<button class="btn perigo sm" id="cr-remover">Remover esta marca</button>'}
            </div>` : ''}

          ${todas.length ? `
            <div class="cr-lista">
              <h3>${todas.length} marca(s) registrada(s)</h3>
              ${todas.map((a) => `
                <button class="cr-linha ${esc(a.tipo)} ${a.id === avariaAberta ? 'on' : ''}"
                        data-ir="${esc(a.id)}">
                  <span class="cr-selo">${numero.get(a.id)}</span>
                  <span class="cr-linha-txt">
                    <b>${esc(tipoDe(a.tipo).nome)}</b>
                    <span class="fraco">${esc(VISTAS[a.vista]?.rotulo ?? a.vista)}</span>
                    ${a.nota ? `<span class="cr-nota-txt">${esc(a.nota)}</span>` : ''}
                  </span>
                </button>`).join('')}
            </div>`
    : `<div class="cr-vazio">
                 Nenhuma marca registrada. Se o veículo chegou sem avaria, siga em frente —
                 as fotos das quatro faces, no grupo <b>Exterior</b>, já ficam como registro.
               </div>`}
        </div>`;
    };

    /* ── Pedido do cliente, achados da oficina e o que foi combinado ────── */

    const ESTADOS_SERVICO = [
      { valor: 'pendente', rotulo: 'Pendente', classe: '' },
      { valor: 'ok', rotulo: 'O.K.', classe: 'ok' },
      { valor: 'nok', rotulo: 'N.O.K.', classe: 'crit' },
    ];

    const linhaServico = (sv, n) => `
      <div class="sv-item ${sv.estado === 'nok' ? 'nok' : ''}" data-servico="${esc(sv.id)}">
        <div class="sv-topo">
          <span class="sv-num">${n}</span>
          <b class="sv-desc">${esc(sv.descricao)}</b>
          ${soLeitura ? '' : `<button class="sv-x" data-apagar-servico aria-label="Remover">×</button>`}
        </div>
        <div class="sv-estados">
          ${ESTADOS_SERVICO.map((e) => `
            <button class="vt-estado ${e.classe} ${(sv.estado ?? 'pendente') === e.valor ? 'on' : ''}"
                    data-estado-servico="${e.valor}">${e.rotulo}</button>`).join('')}
        </div>
        <div class="sv-numeros">
          <label>
            <span>tempo (min)</span>
            <input type="text" inputmode="numeric" data-tempo value="${sv.tempo_min ?? ''}"
                   ${soLeitura ? 'disabled' : ''} placeholder="—">
          </label>
          <label>
            <span>valor (R$)</span>
            <input type="text" inputmode="decimal" data-valor value="${emReais(sv.valor_centavos)}"
                   ${soLeitura ? 'disabled' : ''} placeholder="—">
          </label>
        </div>
      </div>`;

    const desenharPedido = () => {
      const todos = d.servicos ?? [];
      const doCliente = todos.filter((x) => x.origem === 'cliente');
      const daOficina = todos.filter((x) => x.origem === 'vistoria');
      const v2 = d.vistoria;
      const total = todos.reduce((soma, x) => soma + (x.valor_centavos ?? 0), 0);
      const minutos = todos.reduce((soma, x) => soma + (x.tempo_min ?? 0), 0);

      return `
        <div class="sv">
          <div class="vt-posicao">
            <b>O que foi combinado no balcão</b>
            <span>As duas listas ficam separadas de propósito. Na entrega, é a separação
                  que permite dizer “você pediu isto, e nós encontramos aquilo” — misturadas,
                  todo achado parece venda empurrada.</span>
          </div>

          <section class="sv-bloco">
            <h3>Pedido pelo cliente</h3>
            ${doCliente.length
    ? doCliente.map((x, i) => linhaServico(x, i + 1)).join('')
    : '<p class="fraco">Nada anotado ainda. Escreva com as palavras do cliente — “barulho na frente ao frear” vale mais que “revisar freios”.</p>'}
            ${soLeitura ? '' : `
              <form class="sv-add" data-origem="cliente">
                <input type="text" name="descricao" maxlength="300" required
                       placeholder="O que o cliente pediu">
                <button class="btn sm" type="submit">Adicionar</button>
              </form>`}
          </section>

          <section class="sv-bloco">
            <h3>Encontrado pela oficina</h3>
            ${daOficina.length
    ? daOficina.map((x, i) => linhaServico(x, doCliente.length + i + 1)).join('')
    : '<p class="fraco">O que a vistoria revelar e precisar de serviço entra aqui — e é orçado à parte.</p>'}
            ${soLeitura ? '' : `
              <form class="sv-add" data-origem="vistoria">
                <input type="text" name="descricao" maxlength="300" required
                       placeholder="O que a oficina encontrou">
                <button class="btn sm" type="submit">Adicionar</button>
              </form>`}
          </section>

          ${todos.length ? `
            <div class="sv-soma">
              <span>${todos.length} serviço(s)</span>
              ${minutos ? `<span>${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')} de mão de obra</span>` : ''}
              ${total ? `<b>R$ ${emReais(total)}</b>` : ''}
            </div>` : ''}

          <section class="sv-bloco">
            <h3>Combinado na recepção</h3>
            <p class="fraco">São promessas feitas ao cliente na entrada, e ficam na vistoria
               que ele aceita — não num campo solto de observação.</p>
            <div class="sv-campos">
              <label>
                <span>Entrega prevista</span>
                <input type="datetime-local" data-recepcao="entrega_prevista"
                       value="${esc(v2.entrega_prevista ?? '')}" ${soLeitura ? 'disabled' : ''}>
              </label>
              <label>
                <span>Forma de pagamento</span>
                <select data-recepcao="preferencia_pagamento" ${soLeitura ? 'disabled' : ''}>
                  <option value="">a combinar</option>
                  ${PAGAMENTOS.map((f) => `
                    <option value="${f.valor}" ${v2.preferencia_pagamento === f.valor ? 'selected' : ''}>
                      ${esc(f.nome)}
                    </option>`).join('')}
                </select>
              </label>
              <label>
                <span>Próximo serviço em (km)</span>
                <input type="text" inputmode="numeric" data-recepcao="proximo_servico_km"
                       value="${v2.proximo_servico_km ?? ''}" ${soLeitura ? 'disabled' : ''}
                       placeholder="ex.: 92000">
              </label>
              <label>
                <span>Técnico responsável</span>
                <input type="text" data-recepcao="tecnico" maxlength="120"
                       value="${esc(v2.tecnico ?? '')}" ${soLeitura ? 'disabled' : ''}>
              </label>
            </div>
          </section>
        </div>`;
    };

    const recarregar = async () => {
      const novo = await ui.api(`/vistorias/${id}`);
      Object.assign(d, novo);
      recontarGrupos();
      desenhar();
    };

    /* ── Navegação: o técnico não deve caçar o próximo item ───────────────
     *
     * Medido no celular de 375 px: o cabeçalho fixo come 167 px, sobram 645, e
     * o cartão do item tem 394 px de mediana — 1,64 item por tela. Percorrer
     * os 86 itens custava uns cinquenta gestos de rolagem INTERCALADOS com os
     * 86 toques, e é o intercalar que cansa.
     *
     * Verde ou "não se aplica" avança sozinho. Amarelo e vermelho NÃO: esses
     * pedem foto, e levar o técnico embora do item que ele acabou de reprovar
     * é levá-lo embora justamente da hora de fotografar.
     *
     * A regra usa só o catálogo (`foto: 'sempre'`), nunca decide sobre prova —
     * quem valida continua sendo o servidor. Errar aqui custa uma rolagem a
     * mais, e a lista de pendências pega o que passar.
     */
    const avancar = (chave, estado) => {
      if (estado === 'critico' || estado === 'atencao') return;

      const g = d.catalogo.find((x) => x.grupo === atual);
      const def = g?.itens.find((i) => i.chave === chave);
      if (def?.foto === 'sempre') {
        const item = d.itens.find((i) => i.chave === chave);
        if (!(d.midias[item?.id] ?? []).length) return; // ainda falta a foto
      }

      const ordem = g?.itens.map((i) => i.chave) ?? [];
      const daqui = ordem.slice(ordem.indexOf(chave) + 1);
      const proxima = daqui.find((c) => !d.itens.find((i) => i.chave === c)?.estado);

      if (!proxima) { fimDoGrupo(); return; }

      const alvo = el.querySelector(`.vt-item[data-chave="${CSS.escape(proxima)}"]`);
      if (!alvo) return;
      // `start` e não `center`: o cartão tem 394 px e a tela útil 645 — centrar
      // deixaria o de cima meio visível e o técnico marcaria o item errado.
      const topo = alvo.getBoundingClientRect().top + scrollY
        - (el.querySelector('.vistoria-topo')?.getBoundingClientRect().height ?? 0) - 12;
      scrollTo({ top: topo, behavior: 'smooth' });
      alvo.classList.add('mirado');
      setTimeout(() => alvo.classList.remove('mirado'), 900);
    };

    /**
     * Fim do grupo: oferece o próximo com pendência, e não vai sozinho.
     *
     * Trocar de grupo é trocar a posição do VEÍCULO — descer o elevador, fechar
     * o capô. Fazer isso sem perguntar arrastaria a tela para longe de onde o
     * técnico está com as mãos.
     */
    const fimDoGrupo = () => {
      const grupos = d.catalogo.map((x) => x.grupo);
      const daqui = grupos.slice(grupos.indexOf(atual) + 1);
      const proximo = daqui.find((g) => pendentePorGrupo[g])
        ?? grupos.find((g) => pendentePorGrupo[g]);

      const caixa = el.querySelector('#vt-fim');
      if (!caixa) return;
      caixa.hidden = false;
      caixa.innerHTML = proximo
        ? `<b>Grupo concluído.</b>
           <button class="btn sm" data-ir-grupo="${esc(proximo)}">
             Seguir para ${esc(proximo)} →
           </button>`
        : '<b>Todos os grupos preenchidos.</b> Confira as pendências e envie ao cliente.';
      caixa.querySelector('[data-ir-grupo]')?.addEventListener('click', (ev) => {
        trocarAba(ev.currentTarget.dataset.irGrupo);
      });
      caixa.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    /**
     * A folha dos grupos.
     *
     * A tira horizontal media 1494 px de conteúdo dentro de 347 visíveis: 77%
     * das abas ficavam fora da tela, e chegar em "Após o serviço" custava três
     * arrastões laterais às cegas — num gesto que ninguém adivinha existir,
     * porque a tira não mostra que continua.
     *
     * Vertical, os dez cabem de uma vez, e cada um diz ONDE o veículo tem de
     * estar. Isso importa mais do que o nome: o técnico não escolhe "Meia
     * altura", ele escolhe o que dá para fazer com o carro onde ele está.
     */
    const abrirGrupos = () => {
      const linha = (a) => {
        const g = d.catalogo.find((x) => x.grupo === a.chave);
        const n = a.chave === ABA_PEDIDO ? (d.servicos ?? []).length
          : a.chave === ABA_CARROCERIA ? (d.avarias ?? []).length
            : pendentePorGrupo[a.chave] ?? 0;
        const feitos = g
          ? g.itens.filter((i) => d.itens.find((x) => x.chave === i.chave)?.estado).length
          : 0;
        return `
          <button class="vt-lg ${a.chave === atual ? 'on' : ''}" data-grupo-folha="${esc(a.chave)}">
            <span class="vt-lg-txt">
              <b>${esc(a.rotulo)}</b>
              ${g ? `<span class="fraco">${esc(g.posicao)}</span>` : ''}
            </span>
            ${g
    ? `<span class="vt-lg-conta ${feitos === g.itens.length ? 'cheio' : ''}">
                 ${feitos}/${g.itens.length}
               </span>`
    : `<span class="vt-lg-conta">${n || '—'}</span>`}
            ${n && g ? `<span class="vt-falta">${n}</span>` : ''}
          </button>`;
      };

      ui.abrirGaveta(`
        <header class="gaveta-topo">
          <h2>Onde está o veículo?</h2>
          <button class="btn quiet sm" data-fechar>Fechar</button>
        </header>
        <div class="vt-lista-grupos">${abas.map(linha).join('')}</div>`);

      for (const b of document.querySelectorAll('[data-grupo-folha]')) {
        b.onclick = () => {
          const alvo = b.dataset.grupoFolha;
          document.querySelector('.gaveta [data-fechar]')?.click();
          trocarAba(alvo);
        };
      }
    };

    /** Troca de aba num lugar só — a tira, o fim de grupo e o "ver o primeiro". */
    const trocarAba = (nome) => {
      atual = nome;
      sessionStorage.setItem(`vist.${id}.grupo`, atual);
      desenhar();
      el.querySelector('#vt-itens')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    const irAoPendente = () => {
      const pend = d.pendencias[0];
      if (!pend) return;
      if (pend.grupo !== atual) trocarAba(pend.grupo);
      setTimeout(() => {
        el.querySelector(`[data-chave="${CSS.escape(pend.chave)}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
    };

    /* ── Pintura cirúrgica ────────────────────────────────────────────────
     *
     * Redesenhar a tela inteira a cada toque custava caro de um jeito que não
     * aparece no relógio do computador: como o `innerHTML` da raiz é trocado,
     * toda `<img>` de mídia nasce de novo, sem a marca de "já carregada" — e o
     * app rebuscava TODAS as fotos do grupo aberto a cada item marcado.
     *
     * Medido: com duas fotos no grupo, três toques dispararam seis buscas. Num
     * grupo real de 23 itens com seis fotos, marcar os dezessete restantes
     * baixaria cento e duas imagens, no 4G do celular do técnico.
     *
     * Estes três pintores tocam só o que mudou. O `desenhar()` continua
     * existindo para o que muda de estrutura — trocar de aba, abrir avaria.
     */

    const avisoDePendencia = (falta) => (falta === 'nao_avaliado'
      ? 'Falta avaliar este item.'
      : falta === 'foto_do_defeito'
        ? 'Item fora do conforme exige foto — é ela que sustenta o orçamento.'
        : 'Este item exige foto mesmo estando tudo certo.');

    /** Repinta UM cartão: a tarja do semáforo, os botões e o aviso. */
    const pintarItem = (chave) => {
      const cx = el.querySelector(`.vt-item[data-chave="${CSS.escape(chave)}"]`);
      if (!cx) return; // o técnico trocou de grupo antes da resposta chegar
      const item = d.itens.find((i) => i.chave === chave) ?? {};
      const precisa = d.pendencias.find((x) => x.chave === chave);

      cx.className = `vt-item ${item.estado ? `marcado ${item.estado}` : ''} ${precisa ? 'falta' : ''}`;
      for (const b of cx.querySelectorAll('[data-estado]')) {
        b.classList.toggle('on', item.estado === b.dataset.estado);
      }

      /*
       * Amarelo ou vermelho passa a exigir foto — e é por isso que o avanço
       * automático para neste item. Deixar a câmera guardada atrás da ficha
       * anularia a parada: o técnico fica parado sem o motivo à vista.
       */
      if (item.estado === 'critico' || item.estado === 'atencao') {
        const midias = cx.querySelector('.vt-midias');
        if (midias?.hidden) {
          midias.hidden = false;
          cx.querySelector('[data-abrir="midia"]')?.remove();
        }
      }

      const aviso = cx.querySelector('.vt-aviso');
      if (precisa && !aviso) {
        cx.insertAdjacentHTML('beforeend',
          `<div class="vt-aviso">${esc(avisoDePendencia(precisa.falta))}</div>`);
      } else if (precisa) {
        aviso.textContent = avisoDePendencia(precisa.falta);
      } else if (aviso) {
        aviso.remove();
      }
    };

    /** Repinta a barra de progresso e os contadores do topo. */
    const pintarResumo = () => {
      const r = d.resumo;
      const barra = el.querySelector('.vt-barra');
      if (barra) barra.style.width = `${r.percentual}%`;
      el.querySelector('.vt-progresso')?.setAttribute('aria-valuenow', String(r.percentual));
      const conta = el.querySelector('.vt-conta');
      if (conta) {
        conta.innerHTML = `
          <span><b>${r.avaliados}</b> de ${r.total}</span>
          ${r.critico ? `<span class="tag crit">${r.critico} crítico${r.critico > 1 ? 's' : ''}</span>` : ''}
          ${r.atencao ? `<span class="tag warn">${r.atencao} atenção</span>` : ''}
          ${r.ok ? `<span class="tag ok">${r.ok} conforme</span>` : ''}`;
      }
    };

    /** Repinta os números das abas, sem recriar a tira nem perder a rolagem. */
    const pintarAbas = () => {
      for (const aba of el.querySelectorAll('.vt-aba')) {
        const g = aba.dataset.grupo;
        const n = g === ABA_PEDIDO ? (d.servicos ?? []).length
          : g === ABA_CARROCERIA ? (d.avarias ?? []).length
            : pendentePorGrupo[g] ?? 0;
        let selo = aba.querySelector('.vt-falta');
        if (!n && selo) { selo.remove(); continue; }
        if (!n) continue;
        if (!selo) {
          selo = document.createElement('span');
          selo.className = `vt-falta ${g.startsWith('@') ? 'conta' : ''}`;
          aba.appendChild(selo);
        }
        selo.textContent = String(n);
      }
      // O rodapé muda de forma quando a última pendência cai.
      const pend = el.querySelector('.vt-pendente');
      if (pend && !d.pendencias.length) desenhar();
      else if (pend) pend.innerHTML = `<b>${d.pendencias.length}</b> item(ns) faltando —
        <button class="btn quiet sm" id="ir-pendente">ver o primeiro</button>`;
      if (pend) el.querySelector('#ir-pendente')?.addEventListener('click', irAoPendente);
    };

    /**
     * Marca um item — e é a operação mais repetida do app, 86 vezes por vistoria.
     *
     * A tela pinta na hora e o envio vai para a fila. Esperar a rede a cada item
     * torna a vistoria lenta demais para ser feita de verdade — e o que é lento
     * demais é preenchido depois, no computador, de memória, que é exatamente o
     * que a vistoria existe para impedir.
     *
     * O resumo é recontado aqui (contagem, não regra); as PENDÊNCIAS continuam
     * vindo do servidor quando a resposta chega. Duplicar a regra de "o que
     * ainda falta" no navegador daria duas versões dela para divergirem.
     */
    const marcar = (chave, corpo) => {
      const item = d.itens.find((i) => i.chave === chave);
      if (!item) return;
      Object.assign(item, corpo);

      const r = { ok: 0, atencao: 0, critico: 0, na: 0, total: d.itens.length };
      for (const i of d.itens) if (i.estado) r[i.estado] = (r[i.estado] ?? 0) + 1;
      r.avaliados = d.itens.filter((i) => i.estado).length;
      r.pendente = d.itens.length - r.avaliados;
      r.percentual = Math.round((r.avaliados / (d.itens.length || 1)) * 100);
      d.resumo = r;

      /*
       * "Não avaliado" sai da lista no ato — é a única pendência que a tela
       * pode resolver sozinha, porque o item acabou de ganhar estado. A que
       * exige foto continua vindo do servidor: essa depende de regra, e regra
       * duplicada no navegador é regra que um dia diverge.
       */
      if (corpo.estado) {
        d.pendencias = d.pendencias.filter(
          (x) => !(x.chave === chave && x.falta === 'nao_avaliado'));
        recontarGrupos();
      }

      pintarItem(chave);
      pintarResumo();
      pintarAbas();
      if (corpo.estado) avancar(chave, corpo.estado);

      fila.push({
        chave: `${id}:item:${chave}`,
        vistoria: id,
        caminho: `/vistorias/${id}/itens/${chave}`,
        metodo: 'PATCH',
        corpo,
      });
    };

    /* ── Avarias e serviços: envio direto ─────────────────────────────────
     *
     * Ficam fora da fila porque o id vem do servidor: enfileirar exigiria id
     * provisório e reconciliação depois. São poucos e feitos no balcão, onde o
     * sinal é o do escritório — a troca não vale a máquina.
     */
    const salvar = async (caminho, opcoes, aviso) => {
      try {
        return await ui.api(caminho, opcoes);
      } catch (e) {
        ui.toast(aviso, e.message, 'erro');
        return null;
      }
    };

    function ligar() {
      el.querySelectorAll('[data-grupo]').forEach((b) => {
        b.onclick = () => trocarAba(b.dataset.grupo);
      });
      el.querySelector('#vt-abrir-grupos')?.addEventListener('click', abrirGrupos);

      el.querySelectorAll('.vt-item').forEach((cx) => {
        const chave = cx.dataset.chave;

        cx.querySelectorAll('[data-estado]').forEach((b) => {
          b.onclick = () => marcar(chave, { estado: b.dataset.estado });
        });

        const med = cx.querySelector('[data-medida]');
        if (med) {
          med.onchange = () => marcar(chave, { medida: med.value.replace(',', '.') || null });
        }
        const nota = cx.querySelector('[data-nota]');
        if (nota) nota.onchange = () => marcar(chave, { nota: nota.value || null });

        /*
         * A ficha revela em vez de redesenhar: `desenhar()` aqui recriaria os
         * 23 cartões do grupo e rebuscaria as fotos — para mostrar um campo.
         */
        cx.querySelectorAll('[data-abrir]').forEach((b) => {
          b.onclick = () => {
            if (b.dataset.abrir === 'midia') {
              cx.querySelector('.vt-midias').hidden = false;
            } else {
              const campo = document.createElement('input');
              campo.className = 'vt-nota';
              campo.type = 'text';
              campo.placeholder = 'Observação (opcional)';
              campo.dataset.nota = '';
              campo.onchange = () => marcar(chave, { nota: campo.value || null });
              cx.querySelector('.vt-fichas').before(campo);
              campo.focus();
            }
            b.remove();
          };
        });

        const foto = cx.querySelector('[data-foto]');
        if (foto) foto.onchange = () => enviarMidia(cx, chave, foto.files[0], 'foto');
        const video = cx.querySelector('[data-video]');
        if (video) video.onchange = () => enviarMidia(cx, chave, video.files[0], 'video');

        cx.querySelectorAll('[data-apagar]').forEach((b) => {
          b.onclick = async () => {
            try {
              await ui.api(`/vistorias/${id}/midia/${b.dataset.apagar}`, { method: 'DELETE' });
              await recarregar();
            } catch (e) { ui.toast('Não deu para apagar', e.message, 'erro'); }
          };
        });
      });

      el.querySelector('#ir-pendente')?.addEventListener('click', irAoPendente);

      ligarCarroceria();
      ligarPedido();

      el.querySelector('#concluir')?.addEventListener('click', () => concluir(ui, id, d, fila, recarregar));
      el.querySelector('#aceitar')?.addEventListener('click', () => coletarAceite(ui, id, d, recarregar));
    }

    function ligarCarroceria() {
      el.querySelectorAll('[data-vista]').forEach((b) => {
        b.onclick = () => { vista = b.dataset.vista; avariaAberta = null; desenhar(); };
      });
      el.querySelectorAll('[data-tipo]').forEach((b) => {
        b.onclick = () => { tipoAvaria = b.dataset.tipo; desenhar(); };
      });
      el.querySelectorAll('[data-ir]').forEach((b) => {
        b.onclick = () => {
          const a = (d.avarias ?? []).find((x) => x.id === b.dataset.ir);
          if (!a) return;
          vista = a.vista;
          avariaAberta = a.id;
          desenhar();
          el.querySelector('.cr-tela')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        };
      });

      const svg = el.querySelector('#cr-svg');
      if (svg && !soLeitura) {
        svg.onclick = async (e) => {
          const pino = e.target.closest('[data-avaria]');
          if (pino) {
            avariaAberta = avariaAberta === pino.dataset.avaria ? null : pino.dataset.avaria;
            desenhar();
            return;
          }
          /*
           * A marca é gravada em FRAÇÃO da caixa, e não em pixel.
           *
           * O desenho tem 340 px no celular e 640 no monitor do balcão; pixel
           * gravado num apareceria no lugar errado no outro — e o desenho que
           * o cliente assinou tem de ser o mesmo em qualquer tela.
           */
          const cx = svg.getBoundingClientRect();
          const x = (e.clientX - cx.left) / cx.width;
          const y = (e.clientY - cx.top) / cx.height;
          if (x < 0 || x > 1 || y < 0 || y > 1) return;

          const nova = await salvar(`/vistorias/${id}/avarias`, {
            method: 'POST',
            corpo: { vista, x, y, tipo: tipoAvaria },
          }, 'Não deu para marcar a avaria');
          if (!nova) return;
          (d.avarias ??= []).push(nova);
          avariaAberta = nova.id;
          desenhar();
          // O painel da marca nasce abaixo do desenho, e o rodape grudado no pe
          // da tela cobre justamente essa faixa. Sem isto o tecnico marca e nao
          // ve onde escrever a observacao.
          el.querySelector('.cr-aberta')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        };
      }

      el.querySelector('#cr-fechar')?.addEventListener('click', () => {
        avariaAberta = null;
        desenhar();
      });

      const nota = el.querySelector('#cr-nota');
      if (nota) {
        nota.onchange = async () => {
          const a = (d.avarias ?? []).find((x) => x.id === avariaAberta);
          if (!a) return;
          /*
           * A nota é reescrita apagando e remarcando no mesmo ponto.
           *
           * Uma rota de edição existiria só para isto, e abriria a porta para
           * alterar a marca depois do envio — que é exatamente o que o aceite
           * precisa que seja impossível.
           */
          const antes = a.nota;
          a.nota = nota.value || null;
          const r = await salvar(`/vistorias/${id}/avarias/${a.id}`, { method: 'DELETE' },
            'Não deu para gravar a observação');
          if (!r) { a.nota = antes; return; }
          const nova = await salvar(`/vistorias/${id}/avarias`, {
            method: 'POST',
            corpo: { vista: a.vista, x: a.x, y: a.y, tipo: a.tipo, nota: a.nota },
          }, 'Não deu para gravar a observação');
          await recarregar();
          if (nova) { avariaAberta = nova.id; desenhar(); }
        };
      }

      el.querySelector('#cr-remover')?.addEventListener('click', async () => {
        const alvo = avariaAberta;
        if (!alvo) return;
        const r = await salvar(`/vistorias/${id}/avarias/${alvo}`, { method: 'DELETE' },
          'Não deu para remover');
        if (!r) return;
        d.avarias = (d.avarias ?? []).filter((x) => x.id !== alvo);
        avariaAberta = null;
        desenhar();
      });
    }

    function ligarPedido() {
      el.querySelectorAll('.sv-add').forEach((f) => {
        f.onsubmit = async (e) => {
          e.preventDefault();
          const campo = f.querySelector('[name=descricao]');
          const descricao = campo.value.trim();
          if (!descricao) return;
          const novo = await salvar(`/vistorias/${id}/servicos`, {
            method: 'POST',
            corpo: { descricao, origem: f.dataset.origem },
          }, 'Não deu para adicionar');
          if (!novo) return;
          (d.servicos ??= []).push(novo);
          desenhar();
          // O foco volta para o campo: o cliente costuma listar três ou quatro
          // coisas seguidas, e reabrir o teclado a cada uma cansa.
          const proximo = el.querySelector(`.sv-add[data-origem="${f.dataset.origem}"] [name=descricao]`);
          proximo?.focus();
        };
      });

      el.querySelectorAll('[data-servico]').forEach((cx) => {
        const sid = cx.dataset.servico;
        const sv = (d.servicos ?? []).find((x) => x.id === sid);
        if (!sv) return;

        const gravar = async (corpo) => {
          Object.assign(sv, corpo);
          const r = await salvar(`/vistorias/${id}/servicos/${sid}`, { method: 'PATCH', corpo },
            'Não deu para gravar o serviço');
          if (r) Object.assign(sv, r);
          desenhar();
        };

        cx.querySelectorAll('[data-estado-servico]').forEach((b) => {
          b.onclick = () => gravar({ estado: b.dataset.estadoServico });
        });
        const tempo = cx.querySelector('[data-tempo]');
        if (tempo) {
          tempo.onchange = () => gravar({ tempo_min: tempo.value.trim() === '' ? null : Number(tempo.value.replace(/\D/g, '')) });
        }
        const valor = cx.querySelector('[data-valor]');
        if (valor) valor.onchange = () => gravar({ valor_centavos: emCentavos(valor.value) });

        cx.querySelector('[data-apagar-servico]')?.addEventListener('click', async () => {
          const r = await salvar(`/vistorias/${id}/servicos/${sid}`, { method: 'DELETE' },
            'Não deu para remover');
          if (!r) return;
          d.servicos = (d.servicos ?? []).filter((x) => x.id !== sid);
          desenhar();
        });
      });

      el.querySelectorAll('[data-recepcao]').forEach((campo) => {
        campo.onchange = async () => {
          const chave = campo.dataset.recepcao;
          const bruto = campo.value.trim();
          const corpo = {
            [chave]: chave === 'proximo_servico_km'
              ? (bruto === '' ? null : Number(bruto.replace(/\D/g, '')))
              : (bruto || null),
          };
          const r = await salvar(`/vistorias/${id}`, { method: 'PATCH', corpo },
            'Não deu para gravar');
          if (r) Object.assign(d.vistoria, r);
        };
      });
    }

    async function enviarMidia(cx, chave, arquivo, tipo) {
      if (!arquivo) return;
      const marca = cx.querySelector('.vt-midias');
      const antes = marca.style.opacity;
      marca.style.opacity = '.5';
      try {
        let corpo = arquivo;
        let q = `item=${encodeURIComponent(chave)}&tipo=${tipo}`;
        if (tipo === 'foto') {
          const r = await reduzirFoto(arquivo);
          corpo = r.blob;
          q += `&l=${r.largura}&a=${r.altura}`;
        } else if (arquivo.size > 40 * 1024 * 1024) {
          ui.toast('Vídeo grande demais',
            'O limite é 40 MB. Grave um trecho mais curto — dez segundos mostram o defeito.', 'erro');
          marca.style.opacity = antes;
          return;
        }
        const r = await fetch(`/api${''}/vistorias/${id}/midia?${q}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${ui.token()}`,
            'x-instancia': ui.instancia(),
            'content-type': tipo === 'foto' ? 'image/jpeg' : 'video/mp4',
          },
          body: corpo,
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.erro?.mensagem ?? 'Falha no envio.');
        await recarregar();
      } catch (e) {
        ui.toast('Não deu para anexar', e.message, 'erro');
        marca.style.opacity = antes;
      }
    }

    desenhar();
  };
}

/** O que aparece quando a vistoria já saiu de preenchimento. */
function painelFechado(v, d, esc) {
  if (v.status === 'aguardando_aceite') {
    return `
      <div class="vt-rodape">
        <div class="vt-pronto">
          Vistoria enviada. Mostre esta tela ao cliente e colha o aceite —
          <strong>a ordem de serviço só começa depois disso.</strong>
        </div>
        <button class="btn" id="aceitar">Colher aceite do cliente</button>
      </div>`;
  }
  if (v.status === 'aceita') {
    return `
      <div class="vt-rodape">
        <div class="vt-pronto">
          Aceita por <b>${esc(v.aceite_nome ?? '')}</b>.
          A ordem de serviço deste veículo já pode ser iniciada.
        </div>
        ${v.aceite_assinatura ? `<img class="vt-assinatura" src="${esc(v.aceite_assinatura)}" alt="Assinatura do cliente">` : ''}
        <div class="fraco" style="font-family:var(--mono);font-size:11px;word-break:break-all">
          conteúdo ${esc(String(v.conteudo_hash ?? '').slice(0, 32))}…
        </div>
      </div>`;
  }
  return `<div class="vt-rodape"><div class="vt-pendente">
    Vistoria ${esc(v.status)}${v.recusa_motivo ? `: ${esc(v.recusa_motivo)}` : ''}.
  </div></div>`;
}

async function concluir(ui, id, d, fila, recarregar) {
  /*
   * Nada é enviado com marcação ainda na fila.
   *
   * O hash do aceite é calculado sobre o que está NO SERVIDOR. Concluir com
   * três itens ainda por subir gravaria a assinatura de um documento que ainda
   * ia mudar — e o próprio sistema derrubaria o aceite depois, com o cliente
   * já do lado de fora.
   */
  if (!await fila.drenar()) {
    ui.toast('Ainda salvando',
      `Faltam ${fila.estado().pendentes} marcação(ões) para subir. `
      + 'Confira a rede e tente de novo em alguns segundos.', 'erro');
    return;
  }
  await recarregar();

  const r = await ui.perguntar({
    contexto: `${d.vistoria.numero} · ${d.vistoria.placa}`,
    titulo: 'Enviar a vistoria ao cliente?',
    texto: `${d.resumo.critico} crítico(s), ${d.resumo.atencao} em atenção, ${d.resumo.ok} conforme. `
      + 'Depois de enviar, nenhum item pode ser alterado — mudar depois quebraria o aceite. '
      + 'Se precisar corrigir, será preciso abrir outra vistoria.',
    campos: [{ nome: 'observacao', rotulo: 'Observação final (opcional)', dica: 'o que o cliente precisa saber' }],
    confirmar: 'Enviar ao cliente',
  });
  if (!r) return;
  try {
    await ui.api(`/vistorias/${id}/concluir`, { method: 'POST', corpo: { observacao: r.observacao } });
    ui.toast('Vistoria enviada', 'Agora colha o aceite do cliente.');
    await recarregar();
  } catch (e) {
    ui.toast('Não deu para enviar', e.message, 'erro');
  }
}

/**
 * O aceite, com assinatura no dedo.
 *
 * A assinatura não é o que dá validade — quem dá é o registro de QUEM aceitou,
 * QUANDO, e o resumo do conteúdo aceito. Ela existe porque é o gesto que o
 * cliente reconhece: assinar encerra a conversa de um jeito que apertar um
 * botão não encerra.
 */
async function coletarAceite(ui, id, d, recarregar) {
  const veu = document.createElement('div');
  veu.className = 'veu veu-dialogo';
  const cx = document.createElement('div');
  cx.className = 'dialogo aceite';
  cx.innerHTML = `
    <div class="dialogo-ctx">${d.vistoria.numero} · ${d.vistoria.placa}</div>
    <h3>Aceite do cliente</h3>
    <p>Confirme que o estado registrado corresponde ao veículo entregue.
       <strong>A ordem de serviço começa depois deste aceite.</strong></p>
    <div class="campo">
      <label for="ac-nome">Quem está aceitando</label>
      <input id="ac-nome" value="${(d.vistoria.cliente_nome ?? '').replaceAll('"', '&quot;')}">
    </div>
    <div class="campo">
      <label for="ac-cpf">CPF (opcional)</label>
      <input id="ac-cpf" inputmode="numeric" placeholder="somente números">
    </div>
    <div class="campo">
      <label>Assinatura</label>
      <canvas id="ac-assina" class="assinatura-tela" width="600" height="220"></canvas>
      <div class="campo-dica">Assine com o dedo. <button type="button" class="btn quiet sm" id="ac-limpar">Limpar</button></div>
    </div>
    <div class="dialogo-erro" hidden></div>
    <div class="barra-acoes" style="margin-top:16px;justify-content:flex-end">
      <button class="btn quiet" id="ac-recusar">Cliente recusou</button>
      <button class="btn" id="ac-ok">Confirmar aceite</button>
    </div>`;
  document.body.append(veu, cx);

  const tela = cx.querySelector('#ac-assina');
  const ctx = tela.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--txt-hi').trim() || '#fff';
  let desenhando = false;
  let assinou = false;

  const ponto = (ev) => {
    const r = tela.getBoundingClientRect();
    const t = ev.touches?.[0] ?? ev;
    return [(t.clientX - r.left) * (tela.width / r.width), (t.clientY - r.top) * (tela.height / r.height)];
  };
  const comecar = (ev) => { ev.preventDefault(); desenhando = true; assinou = true; ctx.beginPath(); ctx.moveTo(...ponto(ev)); };
  const mover = (ev) => { if (!desenhando) return; ev.preventDefault(); ctx.lineTo(...ponto(ev)); ctx.stroke(); };
  const parar = () => { desenhando = false; };
  tela.addEventListener('pointerdown', comecar);
  tela.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', parar);

  cx.querySelector('#ac-limpar').onclick = () => { ctx.clearRect(0, 0, tela.width, tela.height); assinou = false; };

  const fechar = () => { veu.remove(); cx.remove(); window.removeEventListener('pointerup', parar); };
  veu.onclick = fechar;

  const erro = (m) => {
    const e = cx.querySelector('.dialogo-erro');
    e.textContent = m;
    e.hidden = false;
  };

  cx.querySelector('#ac-ok').onclick = async () => {
    const nome = cx.querySelector('#ac-nome').value.trim();
    if (!nome) return erro('Informe quem está aceitando.');
    if (!assinou) return erro('Peça a assinatura do cliente — é o gesto que encerra a conversa.');
    try {
      await ui.api(`/vistorias/${id}/aceite`, {
        method: 'POST',
        corpo: {
          nome,
          cpf: cx.querySelector('#ac-cpf').value.replace(/\D/g, ''),
          meio: 'assinatura_tela',
          assinatura: tela.toDataURL('image/png'),
        },
      });
      fechar();
      ui.toast('Vistoria aceita', 'A ordem de serviço deste veículo já pode começar.');
      await recarregar();
    } catch (e) { erro(e.message); }
  };

  cx.querySelector('#ac-recusar').onclick = async () => {
    const motivo = prompt('Por que o cliente recusou?');
    if (!motivo) return;
    try {
      await ui.api(`/vistorias/${id}/aceite`, { method: 'POST', corpo: { recusa: true, motivo } });
      fechar();
      ui.toast('Recusa registrada', 'O serviço não começa. Converse com o cliente.');
      await recarregar();
    } catch (e) { erro(e.message); }
  };
}

/* ══ Vida do veículo ═══════════════════════════════════════════════════════ */

export function telaVeiculo(ui) {
  return async (el) => {
    const id = new URLSearchParams(location.hash.split('?')[1] ?? '').get('id');
    if (!id) { location.hash = '#/frota'; return; }

    const d = await ui.api(`/veiculos/${id}`);
    const { esc, data, moeda, numero } = ui;
    const v = d.veiculo;

    const dias = (n) => {
      if (n == null) return '—';
      if (n < 0) return `vencido há ${Math.abs(n)}d`;
      if (n === 0) return 'hoje';
      return `em ${n}d`;
    };

    el.innerHTML = `
      <div class="cabeca">
        <div>
          <div class="kicker">// VIDA DO VEÍCULO</div>
          <h1 class="titulo" style="font-family:var(--mono)">${esc(v.placa)}</h1>
          <p class="chamada">
            ${esc([v.marca, v.modelo, v.ano].filter(Boolean).join(' '))}
            ${v.apelido ? ` — “${esc(v.apelido)}”` : ''} ·
            <strong>${esc(v.cliente_nome)}</strong>
          </p>
        </div>
        <button class="btn" id="nova-leitura">Registrar km</button>
      </div>

      <div class="grade g3">
        <div class="cartao kpi">
          <div class="r">KM HOJE (ESTIMADO)</div>
          <div class="v">${d.uso.kmHoje != null ? numero(d.uso.kmHoje) : '—'}</div>
          <div class="n">última leitura: ${v.km_ultima != null ? numero(v.km_ultima) : '—'} km</div>
        </div>
        <div class="cartao kpi">
          <div class="r">USO MENSAL</div>
          <div class="v ${d.uso.temHistorico ? 'ac' : ''}">${d.uso.mediaKmMes != null ? numero(d.uso.mediaKmMes) : '—'}</div>
          <div class="n">${d.uso.temHistorico
    ? `média de ${d.uso.leituras} leituras`
    : 'faltam leituras — registre o km em cada visita'}</div>
        </div>
        <div class="cartao kpi">
          <div class="r">VISTORIAS</div>
          <div class="v">${d.vistorias.length}</div>
          <div class="n">${d.vistorias.filter((x) => x.status === 'aceita').length} aceita(s)</div>
        </div>
      </div>

      <h2 class="secao">O que vem a seguir</h2>
      ${d.uso.temHistorico ? '' : `<div class="aviso warn">
        <strong>Sem histórico de km, não há previsão.</strong> São necessárias duas leituras de
        hodômetro com pelo menos uma semana entre elas. Registre o km a cada passagem do veículo —
        é o dado que faz o sistema antecipar a manutenção em vez de só registrar o passado.
      </div>`}
      <div class="tabela-caixa"><table>
        <thead><tr><th>Serviço</th><th>Intervalo</th><th>Último</th><th>Próximo</th><th>Vence</th></tr></thead>
        <tbody>${d.planos.map((p) => {
    const j = p.projecao ?? {};
    const urgente = j.dias != null && j.dias <= 30;
    return `<tr class="${j.vencido ? 'linha-crit' : ''}">
            <td class="forte">${esc(p.servico_nome)}</td>
            <td class="fraco">${p.intervalo_km ? `${numero(p.intervalo_km)} km` : ''}${p.intervalo_km && p.intervalo_meses ? ' · ' : ''}${p.intervalo_meses ? `${p.intervalo_meses} m` : ''}</td>
            <td class="fraco">${p.ultimo_km != null ? `${numero(p.ultimo_km)} km` : '—'}</td>
            <td class="num">${p.proximo_km != null ? `${numero(p.proximo_km)} km` : '—'}</td>
            <td><span class="tag ${j.vencido ? 'crit' : urgente ? 'warn' : ''}">${dias(j.dias)}</span>
              ${j.causa ? `<div class="fraco">por ${j.causa}</div>` : ''}</td>
          </tr>`;
  }).join('')}
        </tbody></table></div>

      <h2 class="secao">Linha do tempo</h2>
      ${d.linhaDoTempo.length ? `<div class="linha-tempo">
        ${d.linhaDoTempo.map((e) => `
          <div class="lt-item ${esc(e.tipo)}">
            <div class="lt-quando">${data(e.em)}</div>
            <div class="lt-corpo">
              <b>${esc(e.titulo)}</b>
              <div class="fraco">${esc(e.detalhe ?? '')}${e.km ? ` · ${numero(e.km)} km` : ''}${e.valor_centavos ? ` · ${moeda(e.valor_centavos)}` : ''}</div>
            </div>
          </div>`).join('')}
      </div>` : '<div class="vazio"><h3>Sem histórico ainda</h3></div>'}

      <h2 class="secao">Identificação</h2>
      <dl class="ficha-dl">
        ${[['Placa', v.placa], ['Chassi', v.chassi], ['Renavam', v.renavam], ['Cor', v.cor],
    ['Combustível', v.combustivel], ['Injeção', v.sistema_injecao?.replaceAll('_', ' ')],
    ['Motorização', v.motorizacao], ['Dono', v.cliente_nome], ['Telefone', v.cliente_telefone]]
    .map(([k, val]) => `<div class="par"><dt>${esc(k)}</dt><dd>${esc(val ?? '—')}</dd></div>`).join('')}
      </dl>`;

    el.querySelector('#nova-leitura').onclick = async () => {
      const r = await ui.perguntar({
        contexto: v.placa,
        titulo: 'Registrar leitura do hodômetro',
        texto: 'É esta leitura que alimenta a média de uso e a previsão dos próximos serviços. '
          + 'O hodômetro só anda para a frente — número menor que o anterior é recusado.',
        campos: [{
          nome: 'km', rotulo: 'Km atual', tipo: 'decimal', obrigatorio: true,
          dica: v.km_ultima != null ? `anterior: ${numero(v.km_ultima)}` : 'ex.: 412000',
        }],
        confirmar: 'Registrar',
      });
      if (!r) return;
      try {
        await ui.api(`/veiculos/${id}/km`, { method: 'POST', corpo: { km: r.km } });
        ui.toast('Leitura registrada', 'Previsões recalculadas.');
        ui.navegar();
      } catch (e) { ui.toast('Não deu para registrar', e.message, 'erro'); }
    };
  };
}
