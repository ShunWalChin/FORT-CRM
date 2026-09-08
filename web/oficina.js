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

const LADO_MAXIMO = 1600;
const QUALIDADE = 0.82;

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

    // Grupo aberto: o último visitado, ou o primeiro com pendência.
    const grupos = d.catalogo.map((g) => g.grupo);
    const pendentePorGrupo = {};
    for (const p of d.pendencias) pendentePorGrupo[p.grupo] = (pendentePorGrupo[p.grupo] ?? 0) + 1;
    let atual = sessionStorage.getItem(`vist.${id}.grupo`)
      ?? grupos.find((g) => pendentePorGrupo[g]) ?? grupos[0];

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
          <div class="vt-conta">
            <span><b>${r.avaliados}</b> de ${r.total}</span>
            ${r.critico ? `<span class="tag crit">${r.critico} crítico${r.critico > 1 ? 's' : ''}</span>` : ''}
            ${r.atencao ? `<span class="tag warn">${r.atencao} atenção</span>` : ''}
            ${r.ok ? `<span class="tag ok">${r.ok} conforme</span>` : ''}
          </div>
        </div>

        <div class="vt-grupos" id="vt-grupos">
          ${d.catalogo.map((g) => `
            <button class="vt-aba ${g.grupo === atual ? 'on' : ''}" data-grupo="${esc(g.grupo)}">
              ${esc(g.grupo)}
              ${pendentePorGrupo[g.grupo] ? `<span class="vt-falta">${pendentePorGrupo[g.grupo]}</span>` : ''}
            </button>`).join('')}
        </div>

        <div id="vt-itens">${desenharGrupo(atual)}</div>

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
      carregarMidias(el, ui);
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

            <div class="vt-midias">
              ${midias.map((m) => `
                <div class="vt-foto">
                  ${m.tipo === 'video'
    ? `<video data-midia="${esc(m.id)}" controls playsinline preload="metadata"></video>`
    : `<img data-midia="${esc(m.id)}" alt="${esc(def.nome)}">`}
                  ${soLeitura ? '' : `<button class="vt-tirar" data-apagar="${esc(m.id)}" aria-label="Apagar">×</button>`}
                </div>`).join('')}
              ${soLeitura ? '' : `
                <label class="vt-camera">
                  <input type="file" accept="image/*" capture="environment" hidden data-foto>
                  <span>+ Foto</span>
                </label>
                <label class="vt-camera video">
                  <input type="file" accept="video/*" capture="environment" hidden data-video>
                  <span>+ Vídeo</span>
                </label>`}
            </div>

            ${soLeitura && !item.nota ? '' : `
              <input class="vt-nota" type="text" data-nota placeholder="Observação (opcional)"
                     value="${esc(item.nota ?? '')}" ${soLeitura ? 'disabled' : ''}>`}
            ${precisa ? `<div class="vt-aviso">${precisa.falta === 'nao_avaliado'
    ? 'Falta avaliar este item.'
    : precisa.falta === 'foto_do_defeito'
      ? 'Item fora do conforme exige foto — é ela que sustenta o orçamento.'
      : 'Este item exige foto mesmo estando tudo certo.'}</div>` : ''}
          </div>`;
      }).join('');
    };

    const recarregar = async () => {
      const novo = await ui.api(`/vistorias/${id}`);
      Object.assign(d, novo);
      for (const k of Object.keys(pendentePorGrupo)) delete pendentePorGrupo[k];
      for (const p of d.pendencias) pendentePorGrupo[p.grupo] = (pendentePorGrupo[p.grupo] ?? 0) + 1;
      desenhar();
    };

    const marcar = async (chave, corpo) => {
      try {
        await ui.api(`/vistorias/${id}/itens/${chave}`, { method: 'PATCH', corpo });
        await recarregar();
      } catch (e) { ui.toast('Não deu para marcar', e.message, 'erro'); }
    };

    function ligar() {
      el.querySelectorAll('[data-grupo]').forEach((b) => {
        b.onclick = () => {
          atual = b.dataset.grupo;
          sessionStorage.setItem(`vist.${id}.grupo`, atual);
          desenhar();
          el.querySelector('#vt-itens')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        };
      });

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

      el.querySelector('#ir-pendente')?.addEventListener('click', () => {
        const p = d.pendencias[0];
        atual = p.grupo;
        sessionStorage.setItem(`vist.${id}.grupo`, atual);
        desenhar();
        el.querySelector(`[data-chave="${CSS.escape(p.chave)}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });

      el.querySelector('#concluir')?.addEventListener('click', () => concluir(ui, id, d, recarregar));
      el.querySelector('#aceitar')?.addEventListener('click', () => coletarAceite(ui, id, d, recarregar));
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

async function concluir(ui, id, d, recarregar) {
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
