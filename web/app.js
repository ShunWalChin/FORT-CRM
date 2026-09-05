/**
 * CRM Multiempresas — interface.
 *
 * Sem framework e sem passo de build: o protótipo precisa abrir num notebook
 * sem npm install. O roteamento é por hash, o estado é um objeto e a
 * renderização é string para innerHTML com escape em toda interpolação de dado.
 *
 * A empresa ativa vai no cabeçalho `x-empresa` de toda chamada. O servidor
 * ainda verifica se o usuário tem acesso a ela — a interface nunca é a
 * segurança, é só a conveniência.
 */

import { manualHtml, ligarManual } from './manual.js';
import { telaCentral, telaConversoes, telaAtribuicao } from './telas-aquisicao.js';
import { telaCanais } from './tela-canais.js';
import { icone, aplicarTema, temaAtual, desenharSeletorDeTema } from './ui.js';
import {
  ehMobile, rotularTabelas, desenharNavBaixo, removerNavBaixo, revelarColuna,
  ligarAutoCrescer, CORTE_MOBILE,
} from './mobile.js';

const raiz = document.getElementById('raiz');

const estado = {
  token: localStorage.getItem('fortcrm.token'),
  usuario: null,
  empresas: [],
  empresa: null,
  demoMode: true,
  rota: 'painel',
  cache: {},
  selecionados: new Set(),
};

// ── Utilidades ──────────────────────────────────────────────────────────────
const esc = (v) => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const moeda = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
});

const numero = (n) => Number(n ?? 0).toLocaleString('pt-BR');

const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

const dataHora = (iso) => (iso
  ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—');

function diasAte(iso) {
  if (!iso) return null;
  return Math.round((Date.parse(iso) - Date.now()) / 86400000);
}

const PERFIS = {
  particular: 'Particular', frota: 'Frota', produtor_rural: 'Produtor rural',
  revenda: 'Revenda', consumidor: 'Consumidor',
};
const ETAPAS = {
  novo: 'Novo', qualificado: 'Qualificado', orcamento: 'Orçamento',
  negociacao: 'Negociação', ganho: 'Ganho', perdido: 'Perdido',
};
const CANAIS = {
  whatsapp_cloud: 'WhatsApp oficial', whatsapp_evolution: 'WhatsApp (Evolution)',
  instagram: 'Instagram', webchat: 'Webchat',
};

function toast(texto, sub, tipo = '') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `<div>${esc(texto)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

// ── API ─────────────────────────────────────────────────────────────────────
async function api(caminho, opcoes = {}) {
  const cabecalhos = { 'content-type': 'application/json' };
  if (estado.token) cabecalhos.authorization = `Bearer ${estado.token}`;
  if (estado.empresa) cabecalhos['x-instancia'] = estado.empresa.instancia;

  const r = await fetch(`/api${caminho}`, {
    ...opcoes,
    headers: { ...cabecalhos, ...(opcoes.headers ?? {}) },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const json = await r.json().catch(() => ({ ok: false, erro: { mensagem: 'Resposta ilegível.' } }));

  if (!json.ok) {
    if (r.status === 401) sair();
    const e = new Error(json.erro?.mensagem ?? 'Falha na requisição.');
    e.codigo = json.erro?.codigo;
    e.detalhe = json.erro?.detalhe;
    throw e;
  }
  // Algumas respostas dizem coisas AO LADO do dado — quantos ficaram de fora,
  // em que outras instâncias procurar. Quem precisa disso pede `comMeta`.
  return opcoes.comMeta ? { dados: json.dados, meta: json.meta ?? {} } : json.dados;
}

function sair() {
  localStorage.removeItem('fortcrm.token');
  localStorage.removeItem('fortcrm.empresa');
  // Limpar tudo, não só o token: sobrar `empresas` ou `empresa` em memória faz
  // uma renderização tardia desenhar a casca do sistema com dados de quem já
  // saiu — foi exatamente assim que a tela quebrou depois da recarga da demo.
  estado.token = null;
  estado.usuario = null;
  estado.empresas = [];
  estado.empresa = null;
  estado.cache = {};
  estado.selecionados.clear();
  location.hash = '';
  renderLogin();
}

// ── Login ───────────────────────────────────────────────────────────────────
function renderLogin() {
  raiz.innerHTML = `
    <div class="login">
      <form class="login-caixa" id="form-login">
        <div class="login-marca">// FORT-CRM</div>
        <h1>FORT-CRM</h1>
        <p class="sub">Três empresas, três instâncias, três bancos separados — e uma tela só quando o dono quiser ver tudo.</p>

        <div class="campo">
          <label for="email">E-mail</label>
          <input id="email" name="email" type="email" autocomplete="username" required>
        </div>
        <div class="campo">
          <label for="senha">Senha</label>
          <input id="senha" name="senha" type="password" autocomplete="current-password" required>
        </div>
        <button class="btn bloco" type="submit" style="margin-top:8px">Entrar</button>
        <div id="erro-login"></div>

        <div class="atalhos">
          <div class="t">ACESSOS DE DEMONSTRAÇÃO</div>
          <button type="button" class="atalho" data-e="diretoria@fortgrupo.com.br" data-s="demo">
            <b>Direção do Grupo</b> — as três instâncias
          </button>
          <button type="button" class="atalho" data-e="balcao@minaspecas.com.br" data-s="demo">
            <b>Atendimento Minas Peças</b> — só a oficina
          </button>
          <button type="button" class="atalho" data-e="adenilde@agrofort.com.br" data-s="demo">
            <b>Adenilde — Agrofort</b> — só a fazenda
          </button>
          <button type="button" class="atalho" data-e="loja@forttintas.com.br" data-s="demo">
            <b>Loja — Fort Tintas</b> — só a loja
          </button>
        </div>
      </form>
    </div>`;

  raiz.querySelectorAll('.atalho').forEach((b) => {
    b.onclick = () => {
      raiz.querySelector('#email').value = b.dataset.e;
      raiz.querySelector('#senha').value = b.dataset.s;
      raiz.querySelector('#form-login').requestSubmit();
    };
  });

  raiz.querySelector('#form-login').onsubmit = async (ev) => {
    ev.preventDefault();
    const alvo = ev.target;
    try {
      const d = await api('/sessao', {
        method: 'POST',
        corpo: { email: alvo.email.value, senha: alvo.senha.value },
      });
      estado.token = d.token;
      estado.usuario = d.usuario;
      estado.empresas = d.empresas;
      estado.demoMode = d.demoMode;
      estado.empresa = d.empresas.find((e) => e.instancia === localStorage.getItem('fortcrm.empresa')) ?? d.empresas[0];
      localStorage.setItem('fortcrm.token', d.token);
      localStorage.setItem('fortcrm.empresa', estado.empresa?.instancia ?? '');
      // Depois de entrar, cai no Inicio — a tela que diz o que fazer.
      location.hash = '#/inicio';
      renderShell();
    } catch (e) {
      alvo.querySelector('#erro-login').innerHTML =
        `<div class="aviso crit" style="margin-top:14px">${esc(e.message)}</div>`;
    }
  };
}

// ── Shell ───────────────────────────────────────────────────────────────────
/*
 * Menu por papel.
 *
 * Medido no uso: o atendente de balcão via 16 itens, dos quais 6 eram de
 * governança e aquisição — auditoria, conversões offline, importar base,
 * painel consolidado. Ele não usa nenhum, e cada um deles é ruído entre ele e
 * a fila do dia.
 *
 * `papeis` declara quem vê o quê. Ausente = todo mundo vê. Isto é organização
 * de tela, NUNCA segurança: quem digitar a URL chega igual, e é o servidor que
 * recusa o que não pode. Esconder no menu e confiar nisso seria o erro clássico.
 */
const MENU = [
  { grupo: 'COMECE AQUI' },
  { id: 'inicio', nome: 'Início', ic: 'painel' },
  { id: 'manual', nome: 'Manual do sistema', ic: 'manual' },
  { grupo: 'OPERAÇÃO' },
  { id: 'painel', nome: 'Painel', ic: 'painel' },
  { id: 'regua', nome: 'Régua de contato', ic: 'regua', destaque: true },
  { id: 'clientes', nome: 'Clientes', ic: 'clientes' },
  { id: 'pipeline', nome: 'Pipeline', ic: 'pipeline' },
  { grupo: 'POR EMPRESA' },
  { id: 'frota', nome: 'Frota e veículos', ic: 'frota', empresas: ['MP'] },
  { id: 'ordens', nome: 'Ordens de serviço', ic: 'ordens', empresas: ['MP'] },
  { id: 'pedidos', nome: 'Pedidos e recompra', ic: 'pedidos', empresas: ['AF', 'FT'] },
  { id: 'catalogo', nome: 'Catálogo', ic: 'catalogo' },
  { grupo: 'AQUISIÇÃO' },
  // Canais fica fora do recorte de papel: quem atende é justamente quem
  // pergunta "como você chegou até a gente?", e a tela existe para isso.
  { id: 'canais', nome: 'Canais de entrada', ic: 'canais' },
  { id: 'atribuicao', nome: 'Origem dos leads', ic: 'atribuicao', papeis: ['soberano', 'gestor'] },
  { id: 'conversoes', nome: 'Conversões offline', ic: 'conversoes', destaque: true, papeis: ['soberano', 'gestor'] },
  { grupo: 'GRUPO E GOVERNANÇA', papeis: ['soberano', 'gestor'] },
  { id: 'central', nome: 'Central do grupo', ic: 'central', papeis: ['soberano', 'gestor'], multiEmpresa: true },
  { id: 'grupo', nome: 'Painel consolidado', ic: 'grupo', papeis: ['soberano', 'gestor'], multiEmpresa: true },
  { id: 'gatilhos', nome: 'Gatilhos da régua', ic: 'gatilhos' },
  { id: 'disparos', nome: 'Histórico de disparos', ic: 'disparos' },
  { id: 'auditoria', nome: 'Auditoria', ic: 'auditoria', papeis: ['soberano', 'gestor'] },
  { id: 'importar', nome: 'Importar base', ic: 'importar', papeis: ['soberano', 'gestor'] },
];

function visivelNoMenu(m) {
  const papel = estado.usuario?.papel ?? 'operador';
  if (m.papeis && !m.papeis.includes(papel)) return false;
  if (m.multiEmpresa && estado.empresas.length < 2) return false;
  if (m.empresas && !m.empresas.includes(estado.empresa?.codigo)) return false;
  return true;
}

function renderShell() {
  // Sem sessão ou sem vínculo com empresa nenhuma não existe casca a desenhar —
  // e desenhar mesmo assim produz uma tela sem menu e sem saída.
  if (!estado.token || !estado.empresas.length) return renderLogin();

  /*
   * Pinta a COR DA EMPRESA, não o acento final.
   *
   * Quem calcula o acento é o tema (`temas.css`): nos claros a cor da empresa
   * é escurecida com `color-mix`, senão o ciano #00b8c4 da Minas Peças sobre
   * fundo branco fica em 1.9:1 — ilegível. Escrever `--acento` daqui, como
   * antes, atropelaria essa correção e devolveria o texto apagado.
   */
  const cor = estado.empresa?.cor ?? '#00b8c4';
  document.documentElement.style.setProperty('--empresa-cor', cor);

  raiz.innerHTML = `
    <div class="shell">
      <aside class="lado">
        <div class="lado-topo">
          <div>
            <div class="marca">CRM <span>MULTIEMPRESAS</span></div>
            <div class="marca-sub">${esc(estado.empresa?.nome ?? 'FORT-CRM')}</div>
          </div>
          <button class="abrir-menu" id="abrir-menu" aria-expanded="false" aria-controls="menu">
            ☰ Menu
          </button>
        </div>

        <div class="troca">
          <div class="rot">${estado.empresas.length > 1 ? 'EMPRESA ATIVA' : 'EMPRESA'}</div>
          ${estado.empresas.map((e) => `
            <button class="empresa-btn ${e.instancia === estado.empresa?.instancia ? 'on' : ''}" data-instancia="${esc(e.instancia)}">
              <span class="empresa-cod" style="background:${esc(e.cor)}">${esc(e.codigo)}</span>
              <span>
                <span class="empresa-nome">${esc(e.nome)}</span><br>
                <span class="empresa-seg">instância própria · ${esc(e.cidade ?? '')}</span>
              </span>
            </button>`).join('')}
          ${estado.empresas.length > 1 ? `
            <div class="rot" style="margin-top:12px">TODAS AS INSTÂNCIAS</div>
            <a class="empresa-btn grupo-btn" href="#/central">
              <span class="empresa-cod" style="background:var(--txt-hi);color:#04121a">∑</span>
              <span>
                <span class="empresa-nome">Central do grupo</span><br>
                <span class="empresa-seg">leads de todas as fontes</span>
              </span>
            </a>` : ''}
        </div>

        <div class="menu-busca" id="menu-busca"></div>
        <nav class="menu" id="menu"></nav>

        <div class="lado-rodape">
          ${estado.demoMode ? `<div class="demo-fita">
            <b>DEMO_MODE ligado.</b> Nenhuma mensagem sai para número real. Os disparos são registrados e auditados como simulação.
          </div>` : ''}
          <div class="eu">${esc(estado.usuario?.nome ?? '')}</div>
          <div class="eu-email">${esc(estado.usuario?.email ?? '')}</div>
          ${desenharSeletorDeTema()}
          ${estado.demoMode ? `
            <button class="btn quiet sm bloco" id="reancorar">Reancorar no tempo</button>
            <button class="btn quiet sm bloco" id="recarregar">Recarregar demonstração</button>` : ''}
          <button class="btn quiet sm bloco" id="sair">${icone('sair')} Sair</button>
        </div>
      </aside>
      <main id="conteudo"><div class="carregando">carregando…</div></main>
    </div>`;

  raiz.querySelectorAll('[data-instancia]').forEach((b) => {
    b.onclick = () => {
      estado.empresa = estado.empresas.find((e) => e.instancia === b.dataset.instancia);
      localStorage.setItem('fortcrm.empresa', estado.empresa.instancia);
      estado.cache = {};
      estado.selecionados.clear();
      renderShell();
    };
  });
  raiz.querySelector('#sair').onclick = sair;

  // Delegação: `renderShell` reescreve a lateral inteira, e listener preso a
  // botão morre junto — foi assim que o menu do celular parou de fechar antes.
  raiz.querySelector('.lado-rodape')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tema]');
    if (!b) return;
    aplicarTema(b.dataset.tema);
    raiz.querySelectorAll('.tema-btn').forEach((x) => {
      x.setAttribute('aria-pressed', String(x.dataset.tema === b.dataset.tema));
    });
  });

  // No celular o menu nasce recolhido. Abrir e escolher fecha sozinho — deixar
  // aberto empurraria a tela inteira para baixo de novo, que era o problema.
  const lado = raiz.querySelector('.lado');
  const botaoMenu = raiz.querySelector('#abrir-menu');
  botaoMenu?.addEventListener('click', () => {
    const aberto = lado.classList.toggle('aberto');
    botaoMenu.setAttribute('aria-expanded', String(aberto));
    botaoMenu.textContent = aberto ? '✕ Fechar' : '☰ Menu';
  });
  /*
   * Delegação, e não listener por link: `desenharMenu()` reescreve o innerHTML
   * do menu a cada navegação, e listeners presos aos elementos morrem junto.
   * Foi exatamente esse o bug — no celular o menu abria e não fechava mais ao
   * escolher, empurrando o conteúdo de volta para 812 px do topo.
   */
  lado.addEventListener('click', (ev) => {
    if (!lado.classList.contains('aberto')) return;
    if (!ev.target.closest('nav.menu a, .empresa-btn')) return;
    lado.classList.remove('aberto');
    botaoMenu.setAttribute('aria-expanded', 'false');
    botaoMenu.textContent = '☰ Menu';
  });

  // Depois de disparar a fila, o cooldown esvazia a régua. Numa sequência de
  // reuniões isso apaga justamente a tela que vende.
  /*
   * Reancorar antes de recarregar, sempre que der: a carga gera datas
   * relativas ao instante em que roda, e o compliance vai fechando a janela de
   * 24 h conforme o relógio anda. Medido: nove horas depois da carga, a fila da
   * oficina já havia caído de 16 liberados para 9.
   *
   * Recarregar resolve, mas apaga o que foi demonstrado. Reancorar desliza a
   * história e preserva.
   */
  raiz.querySelector('#reancorar')?.addEventListener('click', async (ev) => {
    const botao = ev.currentTarget;
    botao.disabled = true;
    botao.textContent = 'Reancorando…';
    try {
      const r = await api('/demo/reancorar', { method: 'POST' });
      const movidas = r.instancias.filter((i) => i.deslocouSegundos > 0);
      toast(
        movidas.length ? `${movidas.length} instância(s) reancorada(s)` : 'Nada a reancorar',
        movidas.length
          ? `História deslocada em ${movidas[0].deslocouHoras} h. A fila volta a encher sem perder o que foi feito.`
          : 'A demonstração ainda está no prazo.',
      );
      estado.cache = {};
      navegar();
    } catch (e) {
      toast('Não foi possível reancorar', e.message, 'erro');
    }
    botao.disabled = false;
    botao.textContent = 'Reancorar no tempo';
  });

  raiz.querySelector('#recarregar')?.addEventListener('click', async () => {
    const ok = await perguntar({
      titulo: 'Recarregar a base de demonstração?',
      texto: 'Todos os dados atuais são substituídos pela carga original, e você precisará '
        + 'entrar de novo. A auditoria é preservada.',
      confirmar: 'Recarregar',
      perigo: true,
    });
    if (!ok) return;
    try {
      await api('/demo/reiniciar', { method: 'POST' });
      // A recarga troca todos os identificadores, inclusive o do usuário da
      // sessão. Desmontar a tela em memória deixaria estado apontando para
      // linhas que não existem mais; recarregar a página é a única forma de
      // garantir início limpo.
      localStorage.clear();
      location.replace('/');
    } catch (e) {
      toast('Não foi possível recarregar', e.message, 'erro');
    }
  });

  montarBuscaDoMenu();
  desenharMenu();
  navegar();
}

/*
 * Filtro do menu. Vive fora de `desenharMenu` porque a função é chamada a cada
 * navegação e reescreve o `innerHTML` inteiro — guardar o texto aqui é o que
 * faz o filtro sobreviver ao clique no resultado.
 */

/** Itens que o papel e a empresa ativa permitem, já sem os cabeçalhos. */
function itensDoMenu() {
  return MENU.filter((m) => !m.grupo && visivelNoMenu(m));
}

function desenharMenu() {
  const menu = document.getElementById('menu');
  if (!menu) return;


  const item = (m) => {
    const n = estado.cache.contadores?.[m.id];
    const aqui = estado.rota === m.id;
    return `<a href="#/${m.id}" class="${aqui ? 'on' : ''}" ${aqui ? 'aria-current="page"' : ''}>
      ${icone(m.ic ?? 'painel')}
      <span>${esc(m.nome)}</span>
      ${n ? `<span class="badge-n ${m.destaque ? 'alerta' : ''}">${esc(n)}</span>` : '<span></span>'}
    </a>`;
  };

  const linhas = [];
  MENU.forEach((m, i) => {
    if (m.grupo) {
      // Cabeçalho de grupo cujos itens sumiram também some — por papel, por
      // empresa ou pelo filtro. "GOVERNANÇA" sobre o vazio é pior que nada.
      const adiante = MENU.slice(i + 1);
      const ate = adiante.findIndex((p) => p.grupo);
      const doGrupo = (ate === -1 ? adiante : adiante.slice(0, ate));
      if (!visivelNoMenu(m)) return;
      if (!doGrupo.some((p) => visivelNoMenu(p))) return;
      linhas.push(`<div class="grupo">${esc(m.grupo)}</div>`);
      return;
    }
    if (!visivelNoMenu(m)) return;
    linhas.push(item(m));
  });

  menu.innerHTML = linhas.join('');
}

/*
 * A porta da busca, desenhada uma vez e fora de `desenharMenu`.
 *
 * Fica na lateral porque no celular a lateral recolhida ainda mostra esta
 * faixa — a busca continua a um toque mesmo com o menu fechado.
 */
function montarBuscaDoMenu() {
  /*
   * Uma busca só, e não duas.
   *
   * Aqui havia um "Filtrar telas…" que filtrava o menu — e ele não achava
   * cliente, nem placa, nem OS. Quem digitava "antonio" via "Nada com
   * antonio" e concluía, razoavelmente, que o sistema não tinha o Antônio.
   *
   * Duas caixas de busca com alcances diferentes é pior que uma: a pessoa não
   * tem como saber qual das duas responde a pergunta dela. Esta virou a porta
   * de UMA busca, que acha tela E registro.
   */
  const caixa = document.getElementById('menu-busca');
  if (!caixa) return;
  caixa.innerHTML = `
    <button class="busca-porta" id="abrir-busca" aria-label="Buscar no sistema">
      ${icone('busca')}
      <span>Buscar cliente, OS, placa…</span>
      <kbd>Ctrl K</kbd>
    </button>`;
  caixa.querySelector('#abrir-busca').onclick = () => abrirBusca();
}

// ── Roteamento ──────────────────────────────────────────────────────────────
const VISOES = {};

async function navegar() {
  /*
   * A rota padrão é o INÍCIO, no computador e no celular.
   *
   * Antes era o painel (e a régua no celular). O problema não era o painel
   * estar errado — é que ele responde "como estamos", e quem abre o sistema
   * pela primeira vez pergunta "o que eu faço aqui". Um menu de dezessete
   * itens não responde isso; ele lista, não prioriza.
   *
   * O Início responde, e o primeiro cartão dele é a própria fila com o número
   * do dia — quem já usa continua a um toque do trabalho.
   */
  const padrao = 'inicio';
  // `split('?')` antes de tudo: a gaveta vive em `#/clientes?ficha=abc`, e sem
  // isto a rota viraria "clientes?ficha=abc" e nenhuma tela casaria.
  const rota = (location.hash.split('?')[0].replace('#/', '') || padrao).split('/')[0];
  estado.rota = rota;
  desenharMenu();
  const alvo = document.getElementById('conteudo');
  if (!alvo) return;

  /*
   * Tela que não pertence à empresa ativa abria uma tabela VAZIA, sem uma
   * palavra. O atendente da fazenda entrava em "Frota" e via zero veículos —
   * e a pergunta que se faz nessa hora é "cadê meus dados?", não "essa tela
   * não é da minha empresa". Explicar custa três linhas e evita um chamado.
   */
  const definicao = MENU.find((m) => m.id === rota);
  if (definicao?.empresas && !definicao.empresas.includes(estado.empresa?.codigo)) {
    const donas = definicao.empresas
      .map((c) => estado.empresas.find((e) => e.codigo === c)?.nome ?? c);
    alvo.innerHTML = `
      <div class="vazio">
        <div class="ic">↔</div>
        <h3>“${esc(definicao.nome)}” não é uma tela da ${esc(estado.empresa?.nome ?? 'empresa atual')}</h3>
        <p>Ela pertence a ${esc(donas.join(' e '))}.</p>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          ${definicao.empresas
    .filter((c) => estado.empresas.some((e) => e.codigo === c))
    .map((c) => `<button class="btn sm" data-ir-empresa="${esc(c)}">Ir para ${esc(c)}</button>`).join('')}
          <a class="btn quiet sm" href="#/painel">Voltar ao painel</a>
        </div>
      </div>`;
    alvo.querySelectorAll('[data-ir-empresa]').forEach((b) => {
      b.onclick = () => {
        estado.empresa = estado.empresas.find((e) => e.codigo === b.dataset.irEmpresa);
        localStorage.setItem('fortcrm.empresa', estado.empresa.instancia);
        estado.cache = {};
        renderShell();
      };
    });
    return;
  }

  alvo.innerHTML = '<div class="carregando">carregando…</div>';
  try {
    await (VISOES[rota] ?? VISOES.painel)(alvo);
  } catch (e) {
    alvo.innerHTML = `<div class="aviso crit">${esc(e.message)}</div>`;
  }
  desenharMenu();

  /*
   * Carimba o cabeçalho de cada coluna na própria célula, para que o CSS
   * transforme tabela em cartão no celular.
   *
   * Roda aqui, depois da renderização, em vez de dentro de cada tela: são onze
   * telas com tabela, e duplicar os rótulos em duas camadas é garantir que um
   * dia divirjam. Vale no desktop também — o atributo fica lá, sem efeito.
   */
  rotularTabelas(alvo);
  sincronizarNavBaixo();
  // Link colado ou pagina recarregada com `?ficha=` reabre a ficha.
  restaurarGavetaDaUrl();
  // E `?foco=` acende a linha que a busca mandou procurar.
  focarDaUrl();
}

/** A barra de polegar só existe no celular, e reflete a rota atual. */
function sincronizarNavBaixo() {
  if (!estado.token || !estado.empresas.length) { removerNavBaixo(); return; }
  if (!ehMobile()) { removerNavBaixo(); return; }

  desenharNavBaixo({
    rotaAtual: estado.rota,
    contadores: estado.cache.contadores ?? {},
    aoAbrirMais: () => {
      // "Mais" abre a mesma gaveta do menu — não uma segunda lista de telas
      // que precisaria ser mantida em paralelo.
      const lado = document.querySelector('.lado');
      const botao = document.querySelector('#abrir-menu');
      if (!lado) return;
      const aberto = lado.classList.toggle('aberto');
      if (botao) {
        botao.setAttribute('aria-expanded', String(aberto));
        botao.textContent = aberto ? '✕ Fechar' : '☰ Menu';
      }
      if (aberto) lado.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });
}

/*
 * Atravessar o ponto de corte redesenha a casca.
 *
 * Girar o aparelho ou abrir a janela do navegador muda o que a tela é, e sem
 * isto o celular ficaria com a barra de polegar num layout de desktop — ou
 * pior, sem barra nenhuma e com o menu escondido.
 */
let eraMobile = null;
window.addEventListener('resize', () => {
  const agora = ehMobile();
  if (eraMobile === null) { eraMobile = agora; return; }
  if (agora === eraMobile) return;
  eraMobile = agora;
  if (estado.token && estado.empresas.length) renderShell();
});

window.addEventListener('hashchange', navegar);
ligarAutoCrescer();

/* -- Busca global ---------------------------------------------------------
 *
 * Ctrl+K, ou a porta na lateral.
 *
 * O sistema tem dezessete telas e cinco tipos de registro. Achar "o Antonio"
 * custava saber que cliente mora em Clientes, e achar "a OS dele" custava
 * saber que OS mora noutra tela e que a lista traz duzentas linhas. No balcao,
 * com o cliente esperando, ninguem faz esse percurso.
 *
 * O que esta busca faz de diferente do filtro que havia aqui: ela acha
 * REGISTRO, nao so o nome da tela. E acha por telefone, por placa e por numero
 * de OS, que e como a pessoa realmente identifica o que procura quando esta
 * com o papel na mao.
 */

const semAcento = (v) => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/*
 * Sinonimos das telas.
 *
 * Quase ninguem digita o nome da tela. Quem quer a regua digita "cobranca" ou
 * "whatsapp"; quem quer conversoes digita "meta", "google" ou "campanha". Sem
 * isto, a busca por tela so encontra quem ja sabia o nome do que procurava —
 * que e exatamente quem nao precisava de busca.
 */
const SINONIMOS = {
  inicio: 'home comecar principal atalhos',
  manual: 'ajuda duvida como usar documentacao tutorial explicacao',
  painel: 'dashboard numeros indicadores resultado metricas',
  regua: 'fila hoje contato disparo whatsapp mensagem cobranca lembrete follow up',
  clientes: 'cadastro ficha contato telefone base pessoas cnpj',
  pipeline: 'funil oportunidade negocio venda proposta kanban orcamento',
  frota: 'veiculo caminhao placa trator maquina carro',
  ordens: 'os oficina bancada laudo servico injecao bomba bico reparo',
  pedidos: 'venda recompra compra nota faturamento',
  catalogo: 'produto servico preco sku tabela',
  canais: 'origem entrada anuncio link formulario qr whatsapp captacao',
  atribuicao: 'origem lead anuncio campanha utm gclid fbclid rastreio',
  conversoes: 'meta google ads capi offline feedback campanha retorno',
  central: 'grupo consolidado leads triagem',
  grupo: 'consolidado comparativo empresas visao geral',
  gatilhos: 'regra automacao quando dispara periodicidade',
  disparos: 'historico enviado log mensagem comprovante',
  auditoria: 'log trilha quem fez seguranca registro',
  importar: 'planilha csv carga base migrar excel',
};

const ROTULO_TIPO = {
  tela: 'Telas',
  cliente: 'Clientes',
  veiculo: 'Veículos',
  ordem: 'Ordens de serviço',
  pedido: 'Pedidos',
  oportunidade: 'Oportunidades',
  catalogo: 'Catálogo',
};

/** Telas visiveis PARA ESTA PESSOA que casam com o termo. */
function telasQueCasam(termo) {
  const t = semAcento(termo);
  if (t.length < 2) return [];
  return MENU
    .filter((m) => m.id && visivelNoMenu(m))
    .map((m) => {
      const nome = semAcento(m.nome);
      let ponto = 0;
      if (nome === t) ponto = 3;
      else if (nome.startsWith(t)) ponto = 2.5;
      else if (nome.includes(t)) ponto = 1.6;
      else if ((SINONIMOS[m.id] ?? '').split(' ').some((w) => w && w.startsWith(t))) ponto = 1.2;
      return {
        tipo: 'tela', id: m.id, titulo: m.nome, sub: 'tela do sistema', rota: m.id, ponto,
      };
    })
    .filter((m) => m.ponto > 0)
    .sort((a, b) => b.ponto - a.ponto)
    .slice(0, 5);
}

let buscaAberta = null;
// Resultado guardado por termo: apagar uma letra nao pode custar outra ida ao
// servidor, e digitar "antonio" gera seis termos que ninguem quer refazer.
const cacheBusca = new Map();

function abrirBusca(inicial = '') {
  if (buscaAberta) { buscaAberta.campo.focus(); return; }

  const veu = document.createElement('div');
  veu.className = 'veu veu-busca';
  const cx = document.createElement('div');
  cx.className = 'paleta';
  cx.setAttribute('role', 'dialog');
  cx.setAttribute('aria-modal', 'true');
  cx.setAttribute('aria-label', 'Buscar no sistema');
  cx.innerHTML = `
    <div class="paleta-campo">
      ${icone('busca')}
      <input type="search" autocomplete="off" spellcheck="false" role="combobox"
             aria-expanded="true" aria-controls="paleta-lista"
             placeholder="Nome, telefone, placa, número da OS ou tela…">
      <kbd>Esc</kbd>
    </div>
    <div class="paleta-lista" id="paleta-lista" role="listbox"></div>
    <div class="paleta-rodape">
      <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navegar</span>
      <span><kbd>Enter</kbd> abrir</span>
      <span class="fraco">Buscando em ${esc(estado.empresa?.nome ?? '')}</span>
    </div>`;

  document.body.append(veu, cx);
  travarRolagem(true);
  const campo = cx.querySelector('input');
  const lista = cx.querySelector('.paleta-lista');
  buscaAberta = { cx, veu, campo, lista, itens: [], idx: 0, seq: 0 };

  veu.onclick = () => fecharBusca();
  campo.addEventListener('input', () => rodarBusca(campo.value));
  campo.addEventListener('keydown', teclasDaBusca);
  lista.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-i]');
    if (el) abrirResultado(buscaAberta.itens[Number(el.dataset.i)]);
  });

  campo.value = inicial;
  campo.focus();
  rodarBusca(inicial);
}

function fecharBusca() {
  if (!buscaAberta) return;
  buscaAberta.veu.remove();
  buscaAberta.cx.remove();
  buscaAberta = null;
  travarRolagem(false);
}

function teclasDaBusca(ev) {
  if (!buscaAberta) return;
  const n = buscaAberta.itens.length;
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecharBusca(); return; }
  if (ev.key === 'Enter') {
    ev.preventDefault();
    if (n) abrirResultado(buscaAberta.itens[buscaAberta.idx]);
    return;
  }
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
  ev.preventDefault();
  if (!n) return;
  // Circula: quem esta no ultimo e aperta para baixo volta ao primeiro, em vez
  // de bater numa parede sem aviso.
  buscaAberta.idx = (buscaAberta.idx + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
  marcarSelecionado();
}

function marcarSelecionado() {
  if (!buscaAberta) return;
  buscaAberta.lista.querySelectorAll('[data-i]').forEach((el) => {
    const aqui = Number(el.dataset.i) === buscaAberta.idx;
    el.classList.toggle('on', aqui);
    el.setAttribute('aria-selected', String(aqui));
    if (aqui) el.scrollIntoView({ block: 'nearest' });
  });
}

let temporizadorBusca = null;

function rodarBusca(termo) {
  clearTimeout(temporizadorBusca);
  const t = String(termo ?? '').trim();

  // As telas respondem na hora, sem rede: quem digita "conversoes" nao devia
  // esperar o banco para ver a tela que ja esta no menu ao lado.
  const telas = telasQueCasam(t);
  if (t.length < 2) { pintarBusca(telas, { curto: true, termo: t }); return; }
  if (cacheBusca.has(t)) { pintarBusca(telas.concat(cacheBusca.get(t).dados), { ...cacheBusca.get(t).meta, termo: t }); return; }

  pintarBusca(telas, { termo: t, carregando: true });
  temporizadorBusca = setTimeout(async () => {
    const meu = buscaAberta ? (buscaAberta.seq += 1) : 0;
    try {
      const r = await api(`/buscar?q=${encodeURIComponent(t)}`, { comMeta: true });
      // Resposta atrasada de um termo antigo nao pode sobrescrever a atual —
      // digitar rapido produzia a lista de tres letras atras.
      if (!buscaAberta || meu !== buscaAberta.seq) return;
      cacheBusca.set(t, r);
      if (cacheBusca.size > 40) cacheBusca.delete(cacheBusca.keys().next().value);
      pintarBusca(telas.concat(r.dados), { ...r.meta, termo: t });
    } catch (e) {
      if (buscaAberta) pintarBusca(telas, { termo: t, erro: e.message });
    }
  }, 200);
}

function pintarBusca(itens, ctx = {}) {
  if (!buscaAberta) return;
  buscaAberta.itens = itens;
  buscaAberta.idx = 0;
  const { lista } = buscaAberta;

  if (!itens.length) {
    lista.innerHTML = `<div class="paleta-vazio">
      ${ctx.carregando ? '<div class="fraco">procurando…</div>' : ''}
      ${ctx.erro ? `<div class="paleta-erro">${esc(ctx.erro)}</div>` : ''}
      ${!ctx.carregando && !ctx.erro && ctx.curto
    ? '<div class="fraco">Digite pelo menos duas letras. Vale nome, telefone, placa, número da OS ou o nome de uma tela.</div>'
    : ''}
      ${!ctx.carregando && !ctx.erro && !ctx.curto ? `
        <div class="paleta-nada">
          <b>Nada com &ldquo;${esc(ctx.termo)}&rdquo; em ${esc(ctx.empresa ?? estado.empresa?.nome ?? '')}.</b>
          <div class="fraco">Cada empresa tem o próprio banco — a busca não atravessa sozinha.</div>
          ${(ctx.outras ?? []).length ? `<div class="paleta-outras">
            ${ctx.outras.map((o) => `<button class="btn quiet sm" data-outra="${esc(o.instancia)}">Procurar em ${esc(o.nome)}</button>`).join('')}
          </div>` : ''}
        </div>` : ''}
    </div>`;
    lista.querySelectorAll('[data-outra]').forEach((b) => {
      b.onclick = () => trocarEBuscar(b.dataset.outra, ctx.termo);
    });
    return;
  }

  // Agrupa por tipo mantendo a ordem que o servidor decidiu: o cabecalho e
  // rotulo, nao reordenacao.
  let ultimo = null;
  lista.innerHTML = itens.map((r, i) => {
    const cabeca = r.tipo !== ultimo ? `<div class="paleta-grupo">${esc(ROTULO_TIPO[r.tipo] ?? r.tipo)}</div>` : '';
    ultimo = r.tipo;
    return `${cabeca}
      <div class="paleta-item ${i === 0 ? 'on' : ''}" data-i="${i}" role="option"
           aria-selected="${i === 0}" tabindex="-1">
        <span class="paleta-ic">${icone(r.tipo === 'tela' ? (MENU.find((m) => m.id === r.id)?.ic ?? 'painel') : 'busca')}</span>
        <span class="paleta-txt">
          <span class="paleta-titulo">${esc(r.titulo)}</span>
          ${r.sub ? `<span class="paleta-sub">${esc(r.sub)}</span>` : ''}
        </span>
      </div>`;
  }).join('');
}

/*
 * Trocar de empresa a partir da busca.
 *
 * A troca e REAL: a casca inteira muda de cor e de menu, porque o operador
 * passou a estar noutra empresa. Fingir que so a busca mudou seria deixa-lo
 * clicar num cliente e cair numa tela que ainda diz o nome da empresa anterior.
 */
function trocarEBuscar(instancia, termo) {
  const alvo = estado.empresas.find((e) => e.instancia === instancia);
  if (!alvo) return;
  fecharBusca();
  estado.empresa = alvo;
  localStorage.setItem('fortcrm.empresa', alvo.instancia);
  estado.cache = {};
  estado.selecionados.clear();
  cacheBusca.clear();
  renderShell();
  abrirBusca(termo);
}

function abrirResultado(r) {
  if (!r) return;
  fecharBusca();
  // A gaveta aberta precisa sair ANTES: `restaurarGavetaDaUrl` nao troca uma
  // ficha por outra, ele so abre quando nao ha nenhuma.
  fecharGaveta({ mexerNaUrl: false });
  const alvo = `#/${r.rota}`;
  if (location.hash === alvo) navegar();
  else location.hash = alvo;
}

/*
 * `?foco=` acende a linha que a busca escolheu.
 *
 * Sem isto, buscar uma OS levava a uma tela com duzentas linhas e a pessoa
 * tinha de procurar de novo, agora com os olhos — que e a busca que ela acabou
 * de fazer, feita duas vezes.
 */
function focarDaUrl() {
  const q = location.hash.split('?')[1];
  if (!q) return;
  const id = new URLSearchParams(q).get('foco');
  if (!id) return;
  const el = document.querySelector(`[data-linha="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('focada');
  // O destaque apaga sozinho: linha marcada para sempre vira sujeira na tela
  // quando a pessoa continua trabalhando ali.
  setTimeout(() => el.classList.remove('focada'), 3000);
}

/*
 * Ctrl+K (ou Cmd+K), e `/` quando nao se esta escrevendo.
 *
 * `/` e o atalho que quem usa GitHub, Slack e Gmail ja tem no dedo, e custa
 * uma tecla. A guarda contra campo em foco existe porque sem ela seria
 * impossivel digitar uma barra num endereco ou numa observacao.
 */
document.addEventListener('keydown', (ev) => {
  if (!estado.token || !estado.empresas.length) return;
  const escrevendo = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName ?? '')
    || ev.target?.isContentEditable;

  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) {
    ev.preventDefault();
    if (buscaAberta) fecharBusca(); else abrirBusca();
    return;
  }
  if (ev.key === '/' && !escrevendo && !buscaAberta) {
    ev.preventDefault();
    abrirBusca();
  }
});

// ── Início ──────────────────────────────────────────────────────────────────
/*
 * A tela que diz O QUE FAZER, e não como estamos.
 *
 * O painel responde "como foi o mês". Essa é a segunda pergunta de quem abre o
 * sistema — a primeira é "o que eu faço aqui", e quem nunca viu a ferramenta
 * não faz nem uma nem outra: ele fica olhando para um menu de dezessete itens
 * sem saber por onde começar.
 *
 * Três regras que fazem esta tela funcionar:
 *
 * 1. CADA CARTÃO É NOMEADO PELO QUE A PESSOA QUER FAZER. "Falar com clientes
 *    hoje", não "Régua de contato". O nome da funcionalidade só ensina quem já
 *    sabe o que ela faz.
 *
 * 2. CADA CARTÃO CARREGA ESTADO VIVO. "16 esperando" ensina o que a tela é sem
 *    uma linha de explicação, e mostra onde está o trabalho. Um menu não faz
 *    isso — ele lista, não prioriza.
 *
 * 3. A AÇÃO PRINCIPAL NÃO COMPETE. Ela ocupa a largura toda, com o número em
 *    44px. É a razão de o sistema existir; deixá-la do mesmo tamanho das outras
 *    seria fingir que tudo tem o mesmo peso.
 */
/*
 * Estado vazio com saída.
 *
 * Tela vazia sem explicação é o pior lugar do sistema: quem chega nela não sabe
 * se acabou o trabalho, se filtrou demais ou se algo está desligado. E dizer o
 * motivo sem oferecer o que fazer resolve metade do problema.
 *
 * `tranquilo` distingue "não há nada e está tudo certo" de "não há nada porque
 * algo precisa de você". Pintar as duas iguais faz o operador ignorar as duas.
 */
/*
 * Trava a rolagem do fundo enquanto há algo modal na frente.
 *
 * Sem isto, rolar com o dedo sobre o véu movia a lista ATRÁS da busca: a
 * pessoa fechava e a tela estava noutro lugar, sem ter pedido nada.
 *
 * Conta em vez de ligar e desligar, porque estes se empilham — a busca abre
 * por cima da ficha, e soltar o fundo ao fechar a busca destravaria a tela com
 * a ficha ainda aberta.
 */
let modaisAbertos = 0;
let rolagemGuardada = 0;
function travarRolagem(ligar) {
  const antes = modaisAbertos;
  modaisAbertos = Math.max(0, modaisAbertos + (ligar ? 1 : -1));
  if (antes === 0 && modaisAbertos > 0) {
    /*
     * Guardar a posicao e obrigatorio, nao refinamento.
     *
     * `overflow: hidden` sozinho encolhe a altura rolavel e o navegador joga a
     * pagina para o topo — abrir a busca no meio de uma lista de duzentas
     * linhas e fecha-la devolvia a pessoa ao comeco. O corpo vai para
     * `position: fixed` deslocado pela rolagem atual, o que congela a tela
     * exatamente onde ela estava.
     */
    rolagemGuardada = window.scrollY;
    document.body.style.top = `${-rolagemGuardada}px`;
    document.documentElement.classList.add('travado');
  } else if (antes > 0 && modaisAbertos === 0) {
    document.documentElement.classList.remove('travado');
    document.body.style.top = '';
    window.scrollTo(0, rolagemGuardada);
  }
}

/*
 * Diálogo do sistema, no lugar de `confirm()` e `prompt()` do navegador.
 *
 * Os nativos custam quatro coisas, e as quatro apareceram aqui:
 *
 *   - ignoram os cinco temas. Num sistema desenhado para o balcão sob luz forte
 *     e para o plantão de madrugada, uma caixa branca do Chrome no meio da tela
 *     é a única coisa que não obedece;
 *   - não validam nada. "Pressão medida na bancada (bar)" aceitava qualquer
 *     texto, e o valor ia para o laudo do jeito que foi digitado;
 *   - não mostram contexto. "Motivo da perda" sem dizer QUAL oportunidade —
 *     e quem arrastou três cartões seguidos não sabe mais qual está respondendo;
 *   - alguns navegadores móveis os suprimem ou os empilham fora de ordem.
 *
 * Devolve `null` quando a pessoa desiste, como o nativo. Esc e clique fora
 * fecham; Enter confirma quando não há campo de texto longo.
 */
function perguntar({
  titulo, texto = '', campos = [], confirmar = 'Confirmar', perigo = false, contexto: ctx = '',
  apenasCiencia = false,
}) {
  return new Promise((resolve) => {
    const veu = document.createElement('div');
    veu.className = 'veu veu-dialogo';
    const cx = document.createElement('div');
    cx.className = 'dialogo';
    cx.setAttribute('role', 'dialog');
    cx.setAttribute('aria-modal', 'true');
    cx.setAttribute('aria-label', titulo);

    cx.innerHTML = `
      ${ctx ? `<div class="dialogo-ctx">${esc(ctx)}</div>` : ''}
      <h3>${esc(titulo)}</h3>
      ${texto ? `<p>${esc(texto)}</p>` : ''}
      ${campos.map((c) => `
        <div class="campo">
          ${c.rotulo ? `<label for="dlg-${esc(c.nome)}">${esc(c.rotulo)}</label>` : ''}
          ${c.tipo === 'opcoes'
    ? `<div class="dialogo-opcoes">
                ${c.opcoes.map((o, i) => `
                  <button type="button" class="btn ${i ? 'quiet' : ''}" data-opcao="${esc(o.valor)}">
                    ${esc(o.rotulo)}
                  </button>`).join('')}
              </div>`
    : `<input id="dlg-${esc(c.nome)}" name="${esc(c.nome)}"
                 type="${c.tipo === 'decimal' ? 'text' : esc(c.tipo ?? 'text')}"
                 ${c.tipo === 'decimal' ? 'inputmode="decimal"' : ''}
                 ${c.passo ? `step="${esc(c.passo)}"` : ''}
                 ${c.min !== undefined ? `min="${esc(c.min)}"` : ''}
                 ${c.max !== undefined ? `max="${esc(c.max)}"` : ''}
                 placeholder="${esc(c.dica ?? '')}" value="${esc(c.valor ?? '')}">`}
          ${c.ajuda ? `<div class="campo-dica">${esc(c.ajuda)}</div>` : ''}
        </div>`).join('')}
      <div class="dialogo-erro" hidden></div>
      <div class="barra-acoes" style="margin-top:16px;justify-content:flex-end">
        ${apenasCiencia ? '' : '<button class="btn quiet" data-cancelar>Cancelar</button>'}
        ${campos.some((c) => c.tipo === 'opcoes') ? '' : `<button class="btn ${perigo ? 'perigo' : ''}" data-ok>${esc(confirmar)}</button>`}
      </div>`;

    document.body.append(veu, cx);
    travarRolagem(true);
    const primeiro = cx.querySelector('input, [data-opcao], [data-ok]');
    primeiro?.focus();

    const fechar = (v) => {
      document.removeEventListener('keydown', aoTeclar);
      veu.remove(); cx.remove();
      travarRolagem(false);
      resolve(v);
    };

    const erro = (msg) => {
      const el = cx.querySelector('.dialogo-erro');
      el.textContent = msg;
      el.hidden = false;
    };

    const confirmarAgora = () => {
      const vals = {};
      for (const c of campos) {
        if (c.tipo === 'opcoes') continue;
        const el = cx.querySelector(`[name="${c.nome}"]`);
        const v = String(el.value ?? '').trim();
        // Validar AQUI é metade do motivo de este diálogo existir: o `prompt`
        // devolvia qualquer coisa e o erro só aparecia no banco.
        if (c.obrigatorio && !v) { erro(`${c.rotulo ?? 'Campo'} é obrigatório.`); el.focus(); return; }
        /*
         * `decimal` existe porque `type="number"` DESCARTA a vírgula.
         *
         * O campo de valor da venda aceitava "1650,00" e chegava vazio aqui: o
         * navegador só guarda literal de ponto flutuante em `type=number`, e
         * "1650,00" não é um. Quem escreve dinheiro em português escreve com
         * vírgula, e o campo apagava o que a pessoa digitou sem dizer nada.
         *
         * Texto com `inputmode="decimal"` mantém o teclado numérico no celular
         * e deixa a vírgula chegar até aqui, onde ela é convertida.
         */
        if (v && (c.tipo === 'number' || c.tipo === 'decimal')) {
          // "1.650,00" -> 1650. O ponto e separador de milhar em portugues, e
          // so o campo decimal o interpreta assim; num campo inteiro (pressao
          // de bancada) o ponto nao aparece e nao ha o que remover.
          const cru = c.tipo === 'decimal' ? v.replaceAll('.', '') : v;
          const n = Number(cru.replace(',', '.'));
          if (!Number.isFinite(n)) { erro(`${c.rotulo} precisa ser um número.`); el.focus(); return; }
          if (c.min !== undefined && n < c.min) { erro(`${c.rotulo}: mínimo ${c.min}.`); el.focus(); return; }
          if (c.max !== undefined && n > c.max) { erro(`${c.rotulo}: máximo ${c.max}.`); el.focus(); return; }
          vals[c.nome] = n; continue;
        }
        vals[c.nome] = v || null;
      }
      fechar(campos.length ? vals : true);
    };

    cx.querySelector('[data-cancelar]')?.addEventListener('click', () => fechar(null));
    cx.querySelector('[data-ok]')?.addEventListener('click', confirmarAgora);
    veu.onclick = () => fechar(null);
    cx.querySelectorAll('[data-opcao]').forEach((b) => {
      b.onclick = () => fechar({ opcao: b.dataset.opcao });
    });

    const aoTeclar = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); fechar(null); }
      if (ev.key === 'Enter' && !ev.shiftKey && cx.querySelector('[data-ok]')) {
        ev.preventDefault(); confirmarAgora();
      }
    };
    document.addEventListener('keydown', aoTeclar);
  });
}

function vazio({ ic = '·', titulo, texto = '', acoes = [], tranquilo = false }) {
  return `<div class="vazio ${tranquilo ? 'ok' : ''}">
    <div class="ic">${ic}</div>
    <h3>${esc(titulo)}</h3>
    ${texto ? `<p>${esc(texto)}</p>` : ''}
    ${acoes.length ? `<div class="vazio-acoes">
      ${acoes.map((a, i) => `<a class="btn ${i ? 'quiet' : ''} sm" href="#/${a.rota}">${esc(a.rotulo)}</a>`).join('')}
    </div>` : ''}
  </div>`;
}

VISOES.inicio = async (el) => {
  const d = await api('/painel');
  estado.cache.contadores = { ...estado.cache.contadores, regua: d.regua.liberados };

  const cod = estado.empresa?.codigo;
  const papel = estado.usuario?.papel ?? 'operador';
  const manda = papel === 'soberano' || papel === 'gestor';
  const receita = d.operacao.receitaOs30d + d.operacao.receitaPedidos30d;

  const cartao = ({ rota, ic, titulo, texto, estadoTxt, n, quieto, extra = '' }) => `
    <a class="acao" href="#/${rota}">
      <span class="ic">${icone(ic)}</span>
      <span>
        <h3>${esc(titulo)}</h3>
        <p>${texto}</p>
        ${estadoTxt ? `<span class="estado ${quieto ? 'quieto' : ''}">
          ${n !== undefined ? `<b>${numero(n)}</b>` : ''}${esc(estadoTxt)}
        </span>` : ''}
        ${extra}
      </span>
    </a>`;

  // Por empresa: a oficina tem frota e ordem de serviço; a fazenda e a loja têm
  // pedido. Mostrar as três a todo mundo seria oferecer tela que não existe.
  const daEmpresa = cod === 'MP'
    ? [
      cartao({
        rota: 'ordens', ic: 'ordens', titulo: 'Ordens de serviço',
        texto: 'O que está na bancada, o que ficou pronto e o laudo para entregar ao cliente.',
        estadoTxt: d.operacao.osAbertas === 1 ? ' aberta' : ' abertas', n: d.operacao.osAbertas,
        quieto: !d.operacao.osAbertas,
      }),
      cartao({
        rota: 'frota', ic: 'frota', titulo: 'Frota e veículos',
        texto: 'Placa, quilometragem e a projeção de quando cada bomba vence revisão.',
        estadoTxt: ' veículos', n: d.base.veiculos, quieto: true,
      }),
    ]
    : [
      cartao({
        rota: 'pedidos', ic: 'pedidos', titulo: 'Pedidos e recompra',
        texto: 'O que saiu nos últimos 30 dias e quem está passando do ciclo de recompra.',
        estadoTxt: ' nos últimos 30 dias', n: d.operacao.pedidos30d, quieto: !d.operacao.pedidos30d,
      }),
      cartao({
        rota: 'catalogo', ic: 'catalogo', titulo: 'Catálogo',
        texto: 'Produtos e serviços, com o ciclo de recompra que alimenta os gatilhos.',
        estadoTxt: 'ver itens', quieto: true,
      }),
    ];

  el.innerHTML = `
    <div class="cabeca">
      <div>
        <div class="kicker">// ${esc(cod ?? '')} · ${esc(d.empresa.segmento ?? '')}</div>
        <h1 class="titulo">${esc(d.empresa.nome)}</h1>
      </div>
      <a class="btn quiet" href="#/manual">Como usar o sistema</a>
    </div>

    <p class="inicio-frase">
      Este sistema tem uma função principal: <strong>avisar com quem falar
      hoje</strong> — com a mensagem já escrita — e <strong>recusar o envio
      quando não pode enviar</strong>. O resto existe para sustentar isso.
    </p>

    <div class="acoes">
      <a class="acao principal" href="#/regua">
        <span class="ic">${icone('regua')}</span>
        <span>
          <h3>Falar com clientes hoje</h3>
          <p>
            O sistema montou a fila sozinho: quem precisa ser chamado, por quê, e a
            mensagem pronta para mandar no WhatsApp.
            ${d.regua.bloqueados
    ? `<strong>${numero(d.regua.bloqueados)}</strong> ${d.regua.bloqueados === 1 ? 'está bloqueado' : 'estão bloqueados'} pelo compliance — e o motivo aparece na tela.`
    : ''}
          </p>
        </span>
        <span class="acao-numero">
          <div class="n">${numero(d.regua.liberados)}</div>
          <div class="r">${d.regua.liberados === 1 ? 'PESSOA ESPERANDO' : 'PESSOAS ESPERANDO'}</div>
        </span>
      </a>
    </div>

    <div class="acoes tres">
      ${cartao({
    rota: 'clientes', ic: 'clientes', titulo: 'Achar um cliente',
    texto: 'Histórico, veículos, pedidos e tudo o que já foi conversado.',
    estadoTxt: ' na base', n: d.base.clientes, quieto: true,
    extra: `<span class="acao-busca" onclick="event.preventDefault()">
              <input id="busca-inicio" placeholder="Nome ou telefone…" aria-label="Buscar cliente">
              <button class="btn sm" id="ir-busca">Buscar</button>
            </span>`,
  })}
      ${cartao({
    rota: 'pipeline', ic: 'pipeline', titulo: 'Mover o funil',
    texto: 'Arraste o cartão de etapa. Ganhar ou perder aqui é o que ensina o anúncio.',
    extra: `<span class="estado ${d.pipeline.abertoTotal ? '' : 'quieto'}">
              <b>${moeda(d.pipeline.abertoTotal)}</b> em negociação
            </span>`,
  })}
      ${cartao({
    rota: 'painel', ic: 'painel', titulo: 'Ver os números',
    texto: 'Faturamento, consentimento da base e o que disparou nos últimos dias.',
    extra: `<span class="estado quieto"><b>${moeda(receita)}</b> em 30 dias</span>`,
  })}
    </div>

    <h2 class="secao">Desta empresa</h2>
    <div class="acoes dois">${daEmpresa.join('')}</div>

    <h2 class="secao">De onde vêm os clientes</h2>
    <div class="acoes ${manda ? 'tres' : 'dois'}">
      ${cartao({
    rota: 'canais', ic: 'canais', titulo: 'Canais de entrada',
    texto: 'Por onde o cliente chega, quanto disso dá para medir, e o formulário pronto para o site.',
    estadoTxt: 'ver canais', quieto: true,
  })}
      ${cartao({
    rota: 'gatilhos', ic: 'gatilhos', titulo: 'Gatilhos da régua',
    texto: 'As regras que montam a fila. Ligue, desligue e ajuste o texto de cada uma.',
    estadoTxt: 'ver regras', quieto: true,
  })}
      ${manda ? cartao({
    rota: 'conversoes', ic: 'conversoes', titulo: 'Conversões offline',
    texto: 'O que volta para o Google e para a Meta quando uma venda fecha.',
    estadoTxt: 'ver eventos', quieto: true,
  }) : ''}
    </div>

    ${manda && estado.empresas.length > 1 ? `
      <h2 class="secao">O grupo inteiro</h2>
      <div class="acoes dois">
        ${cartao({
    rota: 'central', ic: 'central', titulo: 'Central do grupo',
    texto: 'Os leads das três empresas num lugar só, com a origem preservada.',
    estadoTxt: 'ver central', quieto: true,
  })}
        ${cartao({
    rota: 'auditoria', ic: 'auditoria', titulo: 'Auditoria',
    texto: 'Quem fez o quê, quando. Registro encadeado — alterar uma linha quebra a cadeia.',
    estadoTxt: 'ver registro', quieto: true,
  })}
      </div>` : ''}

    <div class="inicio-faixa">
      <p>
        <strong>Primeira vez aqui?</strong> O manual explica as telas uma a uma, com
        um botão que abre cada uma de verdade. Leva uns dez minutos.
      </p>
      <a class="btn" href="#/manual">Abrir o manual</a>
    </div>`;

  // Busca do balcão: o cliente está na frente, e dois cliques até a ficha é um
  // clique a mais. Enter vale tanto quanto o botão.
  const campo = el.querySelector('#busca-inicio');
  const irBuscar = (ev) => {
    ev?.preventDefault();
    ev?.stopPropagation();
    const q = campo.value.trim();
    location.hash = q ? `#/clientes?busca=${encodeURIComponent(q)}` : '#/clientes';
  };
  el.querySelector('#ir-busca').onclick = irBuscar;
  campo.onkeydown = (ev) => { if (ev.key === 'Enter') irBuscar(ev); };
  campo.onclick = (ev) => ev.preventDefault();
};

// ── Painel ──────────────────────────────────────────────────────────────────
VISOES.painel = async (el) => {
  const [d, estadoDemo] = await Promise.all([
    api('/painel'),
    // O aviso de envelhecimento não pode derrubar o painel: se a rota falhar,
    // a tela abre igual e só perde o alerta.
    api('/demo/estado').catch(() => null),
  ]);
  estado.cache.contadores = { ...estado.cache.contadores, regua: d.regua.liberados };

  const consentPct = d.base.clientes ? Math.round((d.base.comConsentimento / d.base.clientes) * 100) : 0;
  const receita = d.operacao.receitaOs30d + d.operacao.receitaPedidos30d;

  el.innerHTML = `
    <div class="cabeca">
      <div>
        <div class="kicker">// ${esc(d.empresa.codigo)} · ${esc(d.empresa.segmento)}</div>
        <h1 class="titulo">${esc(d.empresa.nome)}</h1>
        <p class="chamada">O que está na base, o que está em operação e com quem falar hoje.</p>
      </div>
      <a class="btn" href="#/regua">Ver a fila de hoje →</a>
    </div>

    ${estadoDemo?.envelhecida ? `
      <div class="aviso warn">
        <strong>A demonstração está envelhecendo.</strong>
        A carga foi feita há ${esc(estadoDemo.horasMaisVelha)} h, e o compliance já começou a
        fechar a janela de 24 horas dos contatos — a fila encolhe sozinha conforme o relógio anda.
        Clique em <strong>Reancorar no tempo</strong>, na lateral, para deslizar a história
        e devolver a fila sem perder nada do que já foi feito aqui.
      </div>` : ''}

    <div class="grade g4">
      <div class="cartao kpi acento">
        <div class="r">FILA DA RÉGUA HOJE</div>
        <div class="v ac">${numero(d.regua.liberados)}</div>
        <div class="n">${numero(d.regua.bloqueados)} bloqueados pelo compliance</div>
      </div>
      <div class="cartao kpi">
        <div class="r">CLIENTES NA BASE</div>
        <div class="v">${numero(d.base.clientes)}</div>
        <div class="n">${numero(d.base.optOut)} com descadastro</div>
      </div>
      <div class="cartao kpi">
        <div class="r">CONSENTIMENTO LGPD</div>
        <div class="v ${consentPct >= 90 ? 'ok' : consentPct >= 70 ? 'warn' : 'crit'}">${consentPct}%</div>
        <div class="medidor"><i class="${consentPct >= 90 ? '' : consentPct >= 70 ? 'warn' : 'crit'}" style="width:${consentPct}%"></i></div>
      </div>
      <div class="cartao kpi">
        <div class="r">RECEITA · 30 DIAS</div>
        <div class="v">${moeda(receita)}</div>
        <div class="n">${numero(d.operacao.osConcluidas30d)} OS · ${numero(d.operacao.pedidos30d)} pedidos</div>
      </div>
    </div>

    <h2 class="secao">Operação</h2>
    <div class="grade g4">
      <div class="cartao kpi">
        <div class="r">OS EM ABERTO</div><div class="v">${numero(d.operacao.osAbertas)}</div>
      </div>
      <div class="cartao kpi">
        <div class="r">REVISÕES VENCENDO (30D)</div>
        <div class="v ${d.operacao.revisoesVencendo > 0 ? 'warn' : ''}">${numero(d.operacao.revisoesVencendo)}</div>
        <div class="n">projetadas pela média de rodagem</div>
      </div>
      <div class="cartao kpi">
        <div class="r">VEÍCULOS CADASTRADOS</div><div class="v">${numero(d.base.veiculos)}</div>
      </div>
      <div class="cartao kpi">
        <div class="r">PIPELINE PONDERADO</div>
        <div class="v ac">${moeda(d.pipeline.abertoPonderado)}</div>
        <div class="n">de ${moeda(d.pipeline.abertoTotal)} em aberto</div>
      </div>
    </div>

    <h2 class="secao">O que dispara hoje, por gatilho</h2>
    ${d.regua.porGatilho.length ? `
      <div class="tabela-caixa">
        <table>
          <thead><tr><th>Gatilho</th><th class="num">Candidatos</th><th class="num">Liberados</th><th class="num">Bloqueados</th></tr></thead>
          <tbody>${d.regua.porGatilho.map((g) => `
            <tr><td class="forte">${esc(g.nome)}</td>
              <td class="num">${numero(g.n)}</td>
              <td class="num" style="color:var(--ok)">${numero(g.liberados)}</td>
              <td class="num" style="color:var(--dim)">${numero(g.n - g.liberados)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="aviso">Nenhum gatilho com candidatos hoje.</div>'}

    <h2 class="secao">Pipeline por etapa</h2>
    <div class="grade g3">
      ${d.pipeline.porEtapa.filter((p) => p.n > 0).map((p) => `
        <div class="cartao kpi">
          <div class="r">${esc((ETAPAS[p.etapa] ?? p.etapa).toUpperCase())}</div>
          <div class="v" style="font-size:22px">${moeda(p.total)}</div>
          <div class="n">${numero(p.n)} oportunidade(s) · ponderado ${moeda(p.ponderado)}</div>
        </div>`).join('')}
    </div>

    <h2 class="secao">Saída de mensagens</h2>
    <div class="grade g4">
      <div class="cartao kpi"><div class="r">ÚLTIMOS 7 DIAS</div><div class="v">${numero(d.disparos.ultimos7d)}</div></div>
      <div class="cartao kpi"><div class="r">ENVIADAS</div><div class="v ok">${numero(d.disparos.enviados)}</div></div>
      <div class="cartao kpi"><div class="r">BLOQUEADAS</div><div class="v">${numero(d.disparos.bloqueados)}</div></div>
      <div class="cartao kpi">
        <div class="r">AMBÍGUAS (UNKNOWN)</div>
        <div class="v ${d.disparos.desconhecidos ? 'crit' : 'ok'}">${numero(d.disparos.desconhecidos)}</div>
        <div class="n">exigem conferência humana</div>
      </div>
    </div>`;
};

// ── Régua de contato ────────────────────────────────────────────────────────
VISOES.regua = async (el) => {
  const d = await api('/regua');
  estado.cache.regua = d;
  estado.cache.contadores = { ...estado.cache.contadores, regua: d.resumo.liberados };

  el.innerHTML = `
    <div class="cabeca">
      <div>
        <div class="kicker">// RÉGUA DE CONTATO</div>
        <h1 class="titulo">Com quem falar hoje</h1>
        <p class="chamada">
          Cada linha é um cliente que o sistema identificou sozinho, com a mensagem já escrita e o motivo à mostra.
          Tudo passa pelo compliance <strong>antes</strong> de aparecer aqui — o que está bloqueado diz por quê.
        </p>
      </div>
    </div>

    ${estado.demoMode ? `<div class="aviso warn">
      <strong>DEMO_MODE ligado.</strong> Disparar registra a intenção, grava a auditoria e marca como simulado.
      Nenhuma mensagem chega a número real. Para valer, é preciso conectar o canal — e isso exige aprovação nominal.
    </div>` : ''}

    <div class="regua-topo">
      <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="marcar-todos" style="width:17px;height:17px;accent-color:var(--acento)">
        <span style="font-size:13.5px">Marcar todos os liberados</span>
      </label>
      <span class="conta"><b id="conta-sel">0</b> selecionados</span>
      <span style="flex:1"></span>
      <span class="conta">
        <b style="color:var(--ok)">${numero(d.resumo.liberados)}</b> liberados ·
        <b style="color:var(--dim)">${numero(d.resumo.bloqueados)}</b> bloqueados
      </span>
      <button class="btn" id="disparar" disabled>Disparar selecionados</button>
    </div>

    ${d.resumo.motivos.length ? `
      <div class="aviso">
        <strong>Por que ${numero(d.resumo.bloqueados)} não saem:</strong>
        ${d.resumo.motivos.map((m) => `<br>· <code style="color:var(--crit);font-family:var(--mono);font-size:12px">${esc(m.motivo)}</code> — ${esc(m.explicacao)} <span class="tag">${numero(m.n)}</span>`).join('')}
      </div>` : ''}

    ${(d.adiados ?? []).length ? `
      <div class="adiados">
        <div class="t">
          <b>${numero(d.adiados.length)}</b>
          ${d.adiados.length === 1 ? 'contato adiado por você' : 'contatos adiados por você'}.
          Eles voltam sozinhos na data — não somem.
        </div>
        ${d.adiados.map((a) => `
          <div class="adiado-linha">
            <span class="quem">${esc(a.cliente.nome)}</span>
            <span class="fraco">${esc(a.gatilho.nome)}</span>
            <span class="quando">volta ${data(a.ate)}</span>
            <button class="btn sutil sm" data-desadiar="${esc(a.id)}">Trazer de volta</button>
          </div>`).join('')}
      </div>` : ''}

    <div id="fila">
      ${d.fila.length ? d.fila.map(itemRegua).join('') : ''}
      ${!d.fila.length && d.diagnostico ? vazio({
    ic: d.diagnostico.tranquilo ? '✓' : '!',
    titulo: d.diagnostico.titulo,
    texto: d.diagnostico.texto,
    tranquilo: d.diagnostico.tranquilo,
    acoes: [d.diagnostico.acao, d.diagnostico.segunda].filter(Boolean),
  }) : ''}
    </div>`;

  ligarRegua(el);
};

/**
 * Link de conversa já com o texto dentro.
 *
 * Enquanto não há adaptador de canal, ESTE é o uso prático do sistema: o
 * atendente lê o motivo, ajusta a frase e abre a conversa com tudo pronto.
 * Sem isto a régua vira um beco sem saída — mostra a mensagem certa e não
 * deixa fazer nada com ela.
 */
function linkWhatsApp(telefone, texto) {
  const numero = String(telefone ?? '').replace(/[^0-9]/g, '');
  if (!numero) return '#';
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto ?? '')}`;
}

function itemRegua(f) {
  const dias = diasAte(f.vencimentoEm);
  const urg = { vencido: ['crit', 'VENCIDO'], alta: ['warn', 'ALTA'], media: ['', 'MÉDIA'], baixa: ['', 'BAIXA'] }[f.urgencia] ?? ['', ''];
  return `
    <div class="item ${f.decisao.permitido ? '' : 'bloqueado'}" data-item="${esc(f.id)}">
      <div class="item-check">
        <input type="checkbox" data-check="${esc(f.id)}" ${f.decisao.permitido ? '' : 'disabled'}>
      </div>
      <div>
        <h4>${esc(f.cliente.nome)}</h4>
        <div class="linha-meta">
          <span class="tag ac">${esc(f.gatilho.nome)}</span>
          ${urg[1] ? `<span class="tag ${urg[0]}">${urg[1]}</span>` : ''}
          <span class="tag">${esc(PERFIS[f.cliente.perfil] ?? f.cliente.perfil)}</span>
          ${f.cliente.cidade ? `<span class="fraco">${esc(f.cliente.cidade)}</span>` : ''}
          ${dias !== null ? `<span class="fraco">${dias < 0 ? `venceu há ${Math.abs(dias)}d` : `vence em ${dias}d`}</span>` : ''}
        </div>
        <div class="contexto">${esc(f.contexto)}</div>
        <textarea class="mensagem editavel" data-texto="${esc(f.id)}"
          rows="4" spellcheck="true"
          aria-label="Mensagem para ${esc(f.cliente.nome)}">${esc(f.corpo)}</textarea>
        <div class="acoes-msg">
          <button class="btn quiet sm" data-copiar="${esc(f.id)}">Copiar texto</button>
          ${f.cliente.telefone ? `
            <a class="btn quiet sm" target="_blank" rel="noopener"
               data-zap="${esc(f.id)}" href="${esc(linkWhatsApp(f.cliente.telefone, f.corpo))}">
              Abrir no WhatsApp
            </a>` : '<span class="fraco">sem telefone cadastrado</span>'}
          <span class="fraco marca-edicao" data-edicao="${esc(f.id)}"></span>
        </div>
      </div>
      <div class="veredito">
        <div class="r">DECISÃO DO COMPLIANCE</div>
        ${f.decisao.permitido
          ? `<span class="tag ok">LIBERADO</span>
             <div class="motivo">Política aplicada: <code style="color:var(--ok)">${esc(f.decisao.politica)}</code>.
             O contato interagiu dentro da janela e o gatilho está fora do cooldown.</div>`
          : `<span class="tag crit">BLOQUEADO</span>
             <div class="motivo"><code>${esc(f.decisao.motivo)}</code><br>${esc(f.decisao.explicacao ?? '')}</div>`}
        <div class="motivo" style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px">
          Canal: ${esc(CANAIS[f.canal?.tipo] ?? '—')}
          ${f.canal?.conectado ? '' : ' <span class="tag crit">desconectado</span>'}
        </div>
        <button class="btn quiet sm" style="margin-top:10px" data-ficha="${esc(f.cliente.id)}">Ver ficha</button>
        ${f.decisao.permitido ? `<button class="btn sutil sm" style="margin-top:10px"
          data-adiar="${esc(f.cliente.id)}" data-gatilho="${esc(f.gatilho.chave)}"
          data-nome="${esc(f.cliente.nome)}">Adiar</button>` : ''}
      </div>
    </div>`;
}

function ligarRegua(el) {
  // Adiar: "esse eu falo amanhã". Sem isto a fila só tinha disparar ou ignorar,
  // e ignorar faz o item voltar idêntico amanhã.
  el.querySelectorAll('[data-adiar]').forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      const r = await perguntar({
        contexto: b.dataset.nome,
        titulo: 'Adiar este contato',
        texto: 'Ele sai da fila e volta sozinho na data — o gatilho continua ativo para os '
          + 'outros clientes, e os demais motivos deste mesmo cliente continuam valendo.',
        campos: [{
          nome: 'quando', tipo: 'opcoes',
          opcoes: [
            { valor: '1', rotulo: 'Amanhã' },
            { valor: '3', rotulo: 'Em 3 dias' },
            { valor: '7', rotulo: 'Semana que vem' },
            { valor: '30', rotulo: 'Em um mês' },
          ],
        }],
      });
      if (!r) return;
      try {
        const resp = await api('/regua/adiar', {
          method: 'POST',
          corpo: { clienteId: b.dataset.adiar, gatilho: b.dataset.gatilho, dias: Number(r.opcao) },
        });
        toast('Adiado', `${resp.cliente} volta para a fila em ${data(resp.ate)}.`);
        navegar();
      } catch (e) { toast('Não deu para adiar', e.message, 'erro'); }
    };
  });

  el.querySelectorAll('[data-desadiar]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/regua/adiar/${b.dataset.desadiar}/desfazer`, { method: 'POST' });
        toast('De volta à fila');
        navegar();
      } catch (e) { toast('Não deu para desfazer', e.message, 'erro'); }
    };
  });

  const atualizar = () => {
    el.querySelector('#conta-sel').textContent = estado.selecionados.size;
    el.querySelector('#disparar').disabled = estado.selecionados.size === 0;
    el.querySelectorAll('[data-item]').forEach((n) => {
      n.classList.toggle('selecionado', estado.selecionados.has(n.dataset.item));
    });
  };

  el.querySelectorAll('[data-check]').forEach((c) => {
    c.checked = estado.selecionados.has(c.dataset.check);
    c.onchange = () => {
      if (c.checked) estado.selecionados.add(c.dataset.check);
      else estado.selecionados.delete(c.dataset.check);
      atualizar();
    };
  });

  el.querySelector('#marcar-todos').onchange = (ev) => {
    el.querySelectorAll('[data-check]:not([disabled])').forEach((c) => {
      c.checked = ev.target.checked;
      if (ev.target.checked) estado.selecionados.add(c.dataset.check);
      else estado.selecionados.delete(c.dataset.check);
    });
    atualizar();
  };

  el.querySelectorAll('[data-ficha]').forEach((b) => {
    b.onclick = () => abrirFicha(b.dataset.ficha);
  });

  // Texto editado: o link do WhatsApp precisa acompanhar, senão o atendente
  // ajusta a frase, abre a conversa e cola a versão antiga sem perceber.
  const textos = new Map();
  el.querySelectorAll('[data-texto]').forEach((ta) => {
    const id = ta.dataset.texto;
    textos.set(id, ta.defaultValue);

    ta.addEventListener('input', () => {
      const mudou = ta.value.trim() !== ta.defaultValue.trim();
      el.querySelector(`[data-edicao="${CSS.escape(id)}"]`).textContent = mudou ? 'texto ajustado' : '';

      const zap = el.querySelector(`[data-zap="${CSS.escape(id)}"]`);
      if (zap) {
        const tel = zap.getAttribute('href').split('?')[0].replace('https://wa.me/', '');
        zap.href = linkWhatsApp(tel, ta.value);
      }
      // Editar sem marcar é o gesto de quem vai mandar aquele texto.
      const check = el.querySelector(`[data-check="${CSS.escape(id)}"]`);
      if (mudou && check && !check.disabled && !check.checked) {
        check.checked = true;
        estado.selecionados.add(id);
        atualizar();
      }
    });
  });

  el.querySelectorAll('[data-copiar]').forEach((b) => {
    b.onclick = async () => {
      const ta = el.querySelector(`[data-texto="${CSS.escape(b.dataset.copiar)}"]`);
      try {
        await navigator.clipboard.writeText(ta.value);
        const antes = b.textContent;
        b.textContent = 'Copiado ✓';
        setTimeout(() => { b.textContent = antes; }, 1600);
      } catch {
        // Área de transferência bloqueada (contexto não seguro, permissão
        // negada). Selecionar o texto deixa o Ctrl+C a um toque.
        ta.focus();
        ta.select();
        toast('Não consegui copiar', 'O texto está selecionado — use Ctrl+C.', 'erro');
      }
    };
  });

  el.querySelector('#disparar').onclick = async (ev) => {
    const botao = ev.currentTarget;
    botao.disabled = true;
    botao.textContent = 'Disparando…';
    try {
      const r = await api('/regua/disparar', {
        method: 'POST',
        corpo: {
          itens: [...estado.selecionados].map((id) => {
            const ta = el.querySelector(`[data-texto="${CSS.escape(id)}"]`);
            const editado = ta && ta.value.trim() !== ta.defaultValue.trim();
            return editado ? { id, corpo: ta.value } : { id };
          }),
        },
      });
      estado.selecionados.clear();
      const repetidas = r.repetidos
        ? ` ${r.repetidos} já tinham saído hoje e não foram repetidas.`
        : '';
      const editadasBloqueadas = r.resultado.filter((x) => x.editado && x.status === 'blocked');
      if (editadasBloqueadas.length) {
        // O texto ajustado volta pelo compliance. Bloquear em silêncio faria
        // o atendente achar que mandou.
        toast(
          `${editadasBloqueadas.length} mensagem(ns) editada(s) foram bloqueadas`,
          `Motivo: ${[...new Set(editadasBloqueadas.map((x) => x.motivo))].join(', ')}.`,
          'erro',
        );
      }
      toast(
        `${r.enviados} mensagem(ns) registrada(s)`,
        (r.demoMode
          ? 'DEMO_MODE: nada saiu para número real. Tudo consta na auditoria.'
          : 'Enviadas de verdade.') + repetidas,
      );
      navegar();
    } catch (e) {
      toast('Falha ao disparar', e.message, 'erro');
      botao.disabled = false;
      botao.textContent = 'Disparar selecionados';
    }
  };

  atualizar();
}

// ── Clientes ────────────────────────────────────────────────────────────────
VISOES.clientes = async (el) => {
  const desenhar = async (q = '', perfil = '') => {
    const lista = await api(`/clientes?q=${encodeURIComponent(q)}&perfil=${encodeURIComponent(perfil)}`);
    const corpo = el.querySelector('#lista-clientes');
    corpo.innerHTML = lista.length ? `
      <div class="tabela-caixa">
        <table>
          <thead><tr><th>Cliente</th><th>Perfil</th><th>Cidade</th><th>Telefone</th><th>Origem</th><th>LGPD</th><th>Último contato</th></tr></thead>
          <tbody>${lista.map((c) => `
            <tr class="clicavel" data-ficha="${esc(c.id)}">
              <td class="forte">${esc(c.nome)}<div class="fraco">${esc(c.email ?? '')}</div></td>
              <td><span class="tag">${esc(PERFIS[c.perfil] ?? c.perfil)}</span></td>
              <td>${esc(c.cidade ?? '—')}</td>
              <td style="font-family:var(--mono);font-size:12.5px">${esc(c.telefone ?? '—')}</td>
              <td class="fraco">${esc(c.origem)}</td>
              <td>${c.opt_out_em
                ? '<span class="tag crit">descadastrado</span>'
                : c.consentimento_lgpd ? '<span class="tag ok">consentido</span>' : '<span class="tag warn">sem consent.</span>'}</td>
              <td class="fraco">${data(c.ultimo_inbound_em)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : vazio({
      ic: '?',
      titulo: q || perfil ? 'Nenhum cliente com esse filtro' : 'A base ainda está vazia',
      texto: q || perfil
        ? `Nada casou com ${q ? `"${q}"` : 'o perfil escolhido'}. Vale conferir a grafia — a `
          + 'busca também aceita telefone e e-mail.'
        : 'Cadastre o primeiro cliente ou importe uma base existente.',
      acoes: q || perfil ? [] : [
        { rota: 'clientes', rotulo: 'Novo cliente' },
        { rota: 'importar', rotulo: 'Importar base' },
      ],
    })
      + (q || perfil
        ? '<div class="vazio-acoes" style="margin-top:-18px"><button class="btn quiet sm" id="limpar-filtro">Limpar a busca</button></div>'
        : '');

    corpo.querySelectorAll('[data-ficha]').forEach((tr) => {
      tr.onclick = () => abrirFicha(tr.dataset.ficha);
    });
    // Limpar o filtro sem ter de achar e apagar o campo à mão.
    corpo.querySelector('#limpar-filtro')?.addEventListener('click', () => {
      el.querySelector('#q').value = '';
      el.querySelector('#perfil').value = '';
      desenhar();
    });
  };

  el.innerHTML = `
    <div class="cabeca">
      <div>
        <div class="kicker">// BASE ÚNICA</div>
        <h1 class="titulo">Clientes</h1>
        <p class="chamada">Um cliente, um cadastro. A busca por telefone antes de criar é o que impede a base duplicar.</p>
      </div>
      <button class="btn" id="novo-cliente">Novo cliente</button>
    </div>
    <div class="barra-busca">
      <input id="q" placeholder="Buscar por nome, telefone ou e-mail…">
      <select id="perfil">
        <option value="">Todos os perfis</option>
        ${Object.entries(PERFIS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}
      </select>
    </div>
    <div id="lista-clientes"><div class="carregando">carregando…</div></div>`;

  let debounce;
  const disparar = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => desenhar(el.querySelector('#q').value, el.querySelector('#perfil').value), 220);
  };
  el.querySelector('#q').oninput = disparar;
  el.querySelector('#perfil').onchange = disparar;
  el.querySelector('#novo-cliente').onclick = formularioCliente;

  /*
   * Termo vindo do Início (`#/clientes?busca=...`).
   *
   * O balcão é o caso: o cliente está na frente, o atendente digita o nome na
   * tela inicial e já cai aqui filtrado. Sem isto seriam três passos — abrir
   * Clientes, achar o campo, digitar de novo.
   */
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '').get('busca');
  if (q) {
    el.querySelector('#q').value = q;
    el.querySelector('#q').focus();
  }

  await desenhar(q ?? '');
};

function formularioCliente() {
  abrirGaveta(`
    <div class="gaveta-topo">
      <div><div class="kicker">// CADASTRO</div><h2>Novo cliente</h2></div>
      <button class="fechar" data-fechar>fechar</button>
    </div>
    <form id="form-cliente" style="margin-top:18px">
      <div class="campo"><label>Nome *</label><input name="nome" required></div>
      <div class="campo"><label>Telefone (com DDI)</label><input name="telefone" placeholder="5538998112233"></div>
      <div class="campo"><label>E-mail</label><input name="email" type="email"></div>
      <div class="campo"><label>Cidade</label><input name="cidade"></div>
      <div class="campo"><label>Perfil</label>
        <select name="perfil">${Object.entries(PERFIS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select>
      </div>
      <label style="display:flex;gap:9px;align-items:flex-start;margin:16px 0;cursor:pointer">
        <input type="checkbox" name="consentimento" style="width:17px;height:17px;margin-top:2px;accent-color:var(--acento)">
        <span style="font-size:13.5px;color:var(--dim)">
          O cliente autorizou receber mensagens.
          <strong style="color:var(--txt)">Sem esta marcação ele entra na base, mas fica fora da régua.</strong>
        </span>
      </label>
      <div id="erro-cliente"></div>
      <button class="btn bloco" type="submit">Cadastrar</button>
    </form>`);

  document.querySelector('#form-cliente').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api('/clientes', {
        method: 'POST',
        corpo: {
          nome: f.nome.value, telefone: f.telefone.value || null, email: f.email.value || null,
          cidade: f.cidade.value || null, perfil: f.perfil.value,
          consentimento_lgpd: f.consentimento.checked,
        },
      });
      fecharGaveta();
      toast('Cliente cadastrado');
      navegar();
    } catch (e) {
      f.querySelector('#erro-cliente').innerHTML = `<div class="aviso crit">${esc(e.message)}</div>`;
    }
  };
}

// ── Ficha do cliente ────────────────────────────────────────────────────────
async function abrirFicha(id) {
  abrirGaveta('<div class="carregando">carregando ficha…</div>', { ficha: id });
  const d = await api(`/clientes/${id}`);
  const c = d.cliente;

  const eventos = [
    ...d.atividades.map((a) => ({ q: a.criado_em, d: a.descricao, t: a.tipo })),
    ...d.disparos.map((x) => ({
      q: x.criado_em,
      d: `Régua "${x.gatilho_chave}" — ${x.status}${x.motivo ? ` (${x.motivo})` : ''}`,
      t: 'regua',
    })),
  ].sort((a, b) => Date.parse(b.q) - Date.parse(a.q)).slice(0, 25);

  abrirGaveta(`
    <div class="gaveta-topo">
      <div>
        <div class="kicker">// FICHA DO CLIENTE</div>
        <h2>${esc(c.nome)}</h2>
        <div style="margin-top:8px;display:flex;gap:7px;flex-wrap:wrap">
          <span class="tag">${esc(PERFIS[c.perfil] ?? c.perfil)}</span>
          ${c.opt_out_em ? '<span class="tag crit">DESCADASTRADO</span>'
            : c.consentimento_lgpd ? '<span class="tag ok">CONSENTIDO</span>' : '<span class="tag warn">SEM CONSENTIMENTO</span>'}
          <span class="tag">origem: ${esc(c.origem)}</span>
        </div>
      </div>
      <button class="fechar" data-fechar>fechar</button>
    </div>

    <form id="form-ficha" style="margin-top:18px">
      <div class="grade g2" style="gap:10px">
        ${(d.propriedades ?? []).map(campoDaFicha).join('')}
      </div>
      <label style="display:flex;gap:9px;align-items:flex-start;margin:6px 0 14px;cursor:pointer">
        <input type="checkbox" name="consentimento" ${c.consentimento_lgpd ? 'checked' : ''}
          ${c.opt_out_em ? 'disabled' : ''} style="width:17px;height:17px;margin-top:2px;accent-color:var(--acento)">
        <span style="font-size:13.5px;color:var(--dim)">
          Autorizou receber mensagens.
          ${c.opt_out_em
    ? '<strong style="color:var(--crit)">Descadastro registrado — não é possível reativar por aqui.</strong>'
    : '<strong style="color:var(--txt)">Sem isto, ele fica fora da régua.</strong>'}
        </span>
      </label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn sm" type="submit">Salvar alterações</button>
        <span class="fraco" id="ficha-estado"></span>
      </div>
      <div id="erro-ficha"></div>
    </form>

    <dl style="margin-top:16px">
      <div class="par"><dt>Último contato recebido</dt><dd>${data(c.ultimo_inbound_em)}</dd></div>
      <div class="par"><dt>Consentimento em</dt><dd>${data(c.consentimento_em)}</dd></div>
      <div class="par"><dt>Cliente desde</dt><dd>${data(c.criado_em)}</dd></div>
    </dl>

    ${d.veiculos.length ? `
      <h2 class="secao">Veículos</h2>
      ${d.veiculos.map((v) => {
        const r = v.revisao;
        const cor = !r ? '' : r.diasFaltando < 0 ? 'crit' : r.diasFaltando <= 15 ? 'warn' : 'ok';
        return `<div class="cartao" style="margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <span class="forte" style="font-family:var(--mono);letter-spacing:1px">${esc(v.placa)}</span>
              <div class="fraco">${esc([v.marca, v.modelo, v.ano].filter(Boolean).join(' '))} · ${esc(v.motorizacao ?? '')}</div>
            </div>
            <div style="text-align:right">
              ${r ? `<span class="tag ${cor}">${r.diasFaltando < 0 ? `revisão venceu há ${Math.abs(r.diasFaltando)}d` : `revisão em ${r.diasFaltando}d`}</span>
                     <div class="fraco">${numero(r.kmEstimadoHoje)} km estimados</div>`
                  : '<span class="tag">sem média de rodagem</span>'}
            </div>
          </div>
        </div>`;
      }).join('')}` : ''}

    ${d.ordens.length ? `
      <h2 class="secao">Ordens de serviço</h2>
      <div class="tabela-caixa"><table>
        <thead><tr><th>OS</th><th>Componente</th><th>Status</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${d.ordens.map((o) => `
          <tr><td style="font-family:var(--mono)">${esc(o.numero)}</td>
            <td>${esc(o.componente)}<div class="fraco">${data(o.concluida_em ?? o.aberta_em)}</div></td>
            <td><span class="tag ${o.status === 'concluida' ? 'ok' : 'warn'}">${esc(o.status)}</span></td>
            <td class="num">${moeda(o.valor_centavos)}</td>
            <td>${o.status === 'concluida'
              ? `<a class="btn quiet sm" target="_blank" rel="noopener" href="/api/ordens/${esc(o.id)}/laudo?t=${encodeURIComponent(estado.token)}&e=${esc(estado.empresa.id)}">Laudo</a>`
              : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}

    ${d.pedidos.length ? `
      <h2 class="secao">Pedidos</h2>
      <div class="tabela-caixa"><table>
        <thead><tr><th>Pedido</th><th>Itens</th><th>Canal</th><th class="num">Valor</th></tr></thead>
        <tbody>${d.pedidos.map((p) => `
          <tr><td style="font-family:var(--mono)">${esc(p.numero)}<div class="fraco">${data(p.feito_em)}</div></td>
            <td>${esc(JSON.parse(p.itens || '[]').map((i) => `${i.qtd}× ${i.nome}`).join(', '))}</td>
            <td class="fraco">${esc(p.canal)}</td>
            <td class="num">${moeda(p.valor_centavos)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}

    ${eventos.length ? `
      <h2 class="secao">Linha do tempo</h2>
      <div class="linha-tempo">
        ${eventos.map((e) => `<div class="evento">
          <div class="q">${dataHora(e.q)} · ${esc(e.t)}</div>
          <div class="d">${esc(e.d)}</div>
        </div>`).join('')}
      </div>` : ''}

    ${!c.opt_out_em ? `
      <h2 class="secao">LGPD</h2>
      <button class="btn perigo sm" id="optout">Registrar descadastro</button>
      <p class="fraco" style="margin-top:8px">
        Bloqueia qualquer envio automático a este contato, sem exceção. A ação fica na auditoria.
      </p>` : `<div class="aviso crit" style="margin-top:24px">
        Descadastro registrado em ${data(c.opt_out_em)}. Nenhuma mensagem automática sai para este contato.
      </div>`}
  `, { ficha: id });

  /*
 * Desenha um campo a partir da DEFINIÇÃO, não de um `if` por nome.
 *
 * É o ponto da ideia inteira: acrescentar "tipo de bomba" à Minas Peças é uma
 * linha na tabela `propriedades`, e esta função já sabe desenhá-la. Sem isso,
 * cada campo novo custaria alteração no formulário, na tabela, no filtro e na
 * ficha — quatro lugares para esquecer um.
 *
 * Campo de sistema e campo personalizado passam pelo MESMO caminho; o que muda
 * é só o prefixo do `name`, que diz ao servidor onde gravar.
 */
/*
 * Colhe o formulário separando coluna real de campo personalizado.
 *
 * O `name` carrega a distinção — `telefone` vai para a coluna, `campos.metragem`
 * vai para o JSON. Assim o mesmo formulário serve aos dois sem a tela precisar
 * manter uma segunda lista do que é o quê.
 */
function colherCampos(f, propriedades) {
  const saida = { campos: {} };
  for (const p of propriedades) {
    const nome = p.origem === 'sistema' ? p.chave : `campos.${p.chave}`;
    const alvo = f.elements[nome];
    if (!alvo) continue;

    let v;
    if (p.tipo === 'multi_selecao') {
      // Vários checkboxes com o mesmo nome viram RadioNodeList; um só vem
      // como elemento. Tratar os dois casos evita perder a única opção marcada.
      const lista = alvo instanceof RadioNodeList ? [...alvo] : [alvo];
      v = lista.filter((x) => x.checked).map((x) => x.value);
    } else if (p.tipo === 'booleano') {
      v = alvo.checked;
    } else {
      v = String(alvo.value ?? '').trim();
      if (v === '') v = null;
    }

    if (p.origem === 'sistema') saida[p.chave] = v;
    else saida.campos[p.chave] = v;
  }
  return saida;
}

function campoDaFicha(p) {
  const nome = p.origem === 'sistema' ? p.chave : `campos.${p.chave}`;
  const v = p.valor;
  const req = p.obrigatorio ? 'required' : '';
  const largo = p.tipo === 'texto_longo' || p.tipo === 'multi_selecao';

  let entrada;
  switch (p.tipo) {
    case 'texto_longo':
      entrada = `<textarea name="${esc(nome)}" rows="2" ${req}>${esc(v ?? '')}</textarea>`;
      break;
    case 'selecao':
      entrada = `<select name="${esc(nome)}" ${req}>
        <option value="">—</option>
        ${(p.opcoes ?? []).map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(rotuloOpcao(o))}</option>`).join('')}
      </select>`;
      break;
    case 'multi_selecao': {
      const sel = new Set(Array.isArray(v) ? v : (v ? [v] : []));
      entrada = `<div class="multi-opcoes">
        ${(p.opcoes ?? []).map((o) => `
          <label class="opcao">
            <input type="checkbox" name="${esc(nome)}" value="${esc(o)}" ${sel.has(o) ? 'checked' : ''}>
            <span>${esc(rotuloOpcao(o))}</span>
          </label>`).join('')}
      </div>`;
      break;
    }
    case 'booleano':
      entrada = `<label class="opcao"><input type="checkbox" name="${esc(nome)}" ${v ? 'checked' : ''}>
        <span>Sim</span></label>`;
      break;
    case 'numero':
    case 'moeda':
      entrada = `<input name="${esc(nome)}" type="number" step="any" value="${esc(v ?? '')}" ${req}>`;
      break;
    case 'data':
      entrada = `<input name="${esc(nome)}" type="date" value="${esc(String(v ?? '').slice(0, 10))}" ${req}>`;
      break;
    default:
      entrada = `<input name="${esc(nome)}" type="${p.tipo === 'email' ? 'email' : 'text'}"
        value="${esc(v ?? '')}" ${req}>`;
  }

  return `<div class="campo ${largo ? 'campo-largo' : ''}">
    <label>${esc(p.rotulo)}${p.origem === 'custom' ? ' <span class="marca-custom">próprio</span>' : ''}</label>
    ${entrada}
    ${p.descricao ? `<div class="campo-dica">${esc(p.descricao)}</div>` : ''}
  </div>`;
}

/** `produtor_rural` → `Produtor rural`. O banco guarda a chave, a tela mostra gente. */
function rotuloOpcao(o) {
  const s = String(o).replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const form = document.querySelector('#form-ficha');
  if (form) {
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const estadoTxt = f.querySelector('#ficha-estado');
      estadoTxt.textContent = 'salvando…';
      try {
        const r = await api(`/clientes/${id}`, {
          method: 'PATCH',
          corpo: {
            ...colherCampos(f, d.propriedades ?? []),
            ...(c.opt_out_em ? {} : { consentimento_lgpd: f.consentimento.checked }),
          },
        });
        estadoTxt.textContent = 'salvo ✓';
        // O servidor devolve aviso quando descarta chave desconhecida. Engolir
        // isso faria o operador achar que gravou algo que nao gravou.
        if (r?.avisos?.length) toast('Salvo, com ressalva', r.avisos.join(' '));
        else toast('Cliente atualizado');
        // A lista atrás da gaveta mostra nome, telefone e LGPD — deixá-la
        // desatualizada faria o atendente achar que não salvou.
        navegar();
        setTimeout(() => { estadoTxt.textContent = ''; }, 2500);
      } catch (e) {
        estadoTxt.textContent = '';
        f.querySelector('#erro-ficha').innerHTML =
          `<div class="aviso crit" style="margin-top:12px">${esc(e.message)}</div>`;
      }
    };
  }

  document.querySelector('#optout')?.addEventListener('click', async () => {
    const ok = await perguntar({
      contexto: c.nome,
      titulo: 'Registrar descadastro?',
      texto: 'Nenhuma mensagem automática sai para este contato depois disso, e não há como '
        + 'reativar por aqui — só o próprio cliente pedindo de volta.',
      confirmar: 'Registrar descadastro',
      perigo: true,
    });
    if (!ok) return;
    await api(`/clientes/${id}/opt-out`, { method: 'POST' });
    toast('Descadastro registrado', 'O contato saiu de todas as réguas.');
    fecharGaveta();
    navegar();
  });
}

// ── Frota ───────────────────────────────────────────────────────────────────
VISOES.frota = async (el) => {
  const lista = await api('/veiculos');
  const alerta = lista.filter((v) => v.revisao && v.revisao.diasFaltando <= 15).length;

  el.innerHTML = `
    <div class="cabeca">
      <div>
        <div class="kicker">// MÓDULO FROTA E INJEÇÃO</div>
        <h1 class="titulo">Veículos</h1>
        <p class="chamada">
          A chave do relacionamento é a placa. A previsão da próxima revisão é calculada pela média de rodagem
          entre passagens — o veículo não avisa, o sistema estima.
        </p>
      </div>
    </div>

    ${alerta ? `<div class="aviso warn"><strong>${numero(alerta)} veículo(s)</strong> com revisão de injeção vencendo em 15 dias ou já vencida.</div>` : ''}

    <div class="tabela-caixa">
      <table>
        <thead><tr>
          <th>Placa</th><th>Veículo</th><th>Sistema</th><th>Responsável</th>
          <th class="num">KM último</th><th class="num">Média/mês</th><th>Próxima revisão</th>
        </tr></thead>
        <tbody>${lista.map((v) => {
          const r = v.revisao;
          const cor = !r ? '' : r.diasFaltando < 0 ? 'crit' : r.diasFaltando <= 15 ? 'warn' : 'ok';
          return `<tr class="clicavel" data-ficha="${esc(v.cliente_id)}">
            <td class="forte" style="font-family:var(--mono);letter-spacing:1px">${esc(v.placa)}</td>
            <td>${esc([v.marca, v.modelo].filter(Boolean).join(' '))}<div class="fraco">${esc(v.ano ?? '')} · ${esc(v.motorizacao ?? '')}</div></td>
            <td class="fraco">${esc(v.sistema_injecao.replaceAll('_', ' '))}</td>
            <td>${esc(v.cliente_nome)}<div class="fraco">${esc(PERFIS[v.cliente_perfil] ?? '')}</div></td>
            <td class="num">${v.km_ultima ? numero(v.km_ultima) : `${numero(v.horimetro)} h`}</td>
            <td class="num">${v.media_km_mes ? numero(v.media_km_mes) : '—'}</td>
            <td>${r
              ? `<span class="tag ${cor}">${r.diasFaltando < 0 ? `venceu há ${Math.abs(r.diasFaltando)}d` : `em ${r.diasFaltando}d`}</span>
                 <div class="fraco">${data(r.dataPrevista)} · ${numero(r.alvoKm)} km</div>`
              : '<span class="tag">sem projeção</span><div class="fraco">falta média de rodagem</div>'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll('[data-ficha]').forEach((tr) => { tr.onclick = () => abrirFicha(tr.dataset.ficha); });
};

// ── Ordens de serviço ───────────────────────────────────────────────────────
VISOES.ordens = async (el) => {
  const lista = await api('/ordens');
  el.innerHTML = `
    <div class="cabeca">
      <div>
        <div class="kicker">// OFICINA</div>
        <h1 class="titulo">Ordens de serviço</h1>
        <p class="chamada">
          Todo serviço concluído gera laudo digital de bancada — pressão medida, peça aplicada, garantia e parecer,
          num documento que o cliente guarda. É o que elimina a pergunta "será que trocaram mesmo?".
        </p>
      </div>
    </div>
    <div class="tabela-caixa">
      <table>
        <thead><tr><th>OS</th><th>Cliente</th><th>Veículo</th><th>Componente</th><th>Bancada</th>
          <th class="num">Pressão</th><th class="num">Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${lista.map((o) => `
          <tr data-linha="${esc(o.id)}">
            <td class="forte" style="font-family:var(--mono)">${esc(o.numero)}<div class="fraco">${data(o.concluida_em ?? o.aberta_em)}</div></td>
            <td>${esc(o.cliente_nome)}</td>
            <td style="font-family:var(--mono);font-size:12.5px">${esc(o.placa ?? '—')}<div class="fraco">${esc([o.marca, o.modelo].filter(Boolean).join(' '))}</div></td>
            <td>${esc(o.componente)}</td>
            <td class="fraco">${esc(o.bancada ?? '—')}</td>
            <td class="num">${o.pressao_bar ? `${numero(o.pressao_bar)} bar` : '—'}</td>
            <td class="num">${moeda(o.valor_centavos)}</td>
            <td><span class="tag ${o.status === 'concluida' ? 'ok' : o.status === 'em_bancada' ? 'warn' : ''}">${esc(o.status.replaceAll('_', ' '))}</span></td>
            <td>${o.status === 'concluida'
              ? `<a class="btn quiet sm" target="_blank" rel="noopener" href="/api/ordens/${esc(o.id)}/laudo?t=${encodeURIComponent(estado.token)}&e=${esc(estado.empresa.id)}">Laudo</a>`
              : `<button class="btn sm" data-concluir="${esc(o.id)}">Concluir</button>`}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll('[data-concluir]').forEach((b) => {
    b.onclick = async () => {
      // Campo numérico com limites reais de bancada, validado antes de sair
      // daqui: o `prompt` aceitava qualquer texto e o valor ia para o laudo.
      const os = lista.find((x) => x.id === b.dataset.concluir) ?? {};
      const r = await perguntar({
        contexto: [os.numero && `OS ${os.numero}`, os.cliente_nome].filter(Boolean).join(' · '),
        titulo: 'Concluir ordem de serviço',
        texto: 'A pressão medida entra no laudo digital. Deixe vazio se não se aplica a este serviço.',
        campos: [{
          nome: 'pressao', rotulo: 'Pressão na bancada (bar)', tipo: 'number',
          passo: '1', min: 0, max: 3000, dica: 'ex.: 1800',
          ajuda: 'Entre 0 e 3000 bar.',
        }],
        confirmar: 'Concluir',
      });
      if (!r) return;
      const pressao = r.pressao;
      if (pressao === null) return;
      await api(`/ordens/${b.dataset.concluir}/concluir`, {
        method: 'POST',
        corpo: {
          pressao_bar: pressao ? Number(pressao) : null,
          resultado_laudo: pressao
            ? `Aprovado — pressão dentro da faixa Bosch (${pressao} bar).`
            : 'Aprovado — sem falha registrada.',
        },
      });
      toast('OS concluída', 'O laudo digital já pode ser gerado.');
      navegar();
    };
  });
};

// ── Pedidos ─────────────────────────────────────────────────────────────────
VISOES.pedidos = async (el) => {
  const lista = await api('/pedidos');
  el.innerHTML = `
    <div class="cabeca">
      <div>
        <div class="kicker">// RECOMPRA</div>
        <h1 class="titulo">Pedidos</h1>
        <p class="chamada">
          Queijo artesanal é consumo recorrente vendido hoje como compra única. Cada pedido registra o cliente e
          agenda o próximo contato pelo ciclo do produto.
        </p>
      </div>
    </div>
    <div class="tabela-caixa">
      <table>
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Canal</th>
          <th class="num">Valor</th><th class="num">Ciclo</th><th>Próximo contato</th><th>Status</th></tr></thead>
        <tbody>${lista.map((p) => {
          const prox = diasAte(p.proximo_contato_em);
          return `<tr class="clicavel" data-linha="${esc(p.id)}" data-ficha="${esc(p.cliente_id)}">
            <td class="forte" style="font-family:var(--mono)">${esc(p.numero)}<div class="fraco">${data(p.feito_em)}</div></td>
            <td>${esc(p.cliente_nome)}<div class="fraco">${esc(p.cidade ?? '')}</div></td>
            <td>${esc(JSON.parse(p.itens || '[]').map((i) => `${i.qtd}× ${i.nome}`).join(', '))}</td>
            <td class="fraco">${esc(p.canal)}</td>
            <td class="num">${moeda(p.valor_centavos)}</td>
            <td class="num">${numero(p.ciclo_recompra_dias)}d</td>
            <td>${prox === null ? '—'
              : prox <= 0 ? `<span class="tag warn">vencido há ${Math.abs(prox)}d</span>`
              : `<span class="tag">em ${prox}d</span>`}</td>
            <td><span class="tag ${p.status === 'entregue' ? 'ok' : 'warn'}">${esc(p.status)}</span></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;
  el.querySelectorAll('[data-ficha]').forEach((tr) => { tr.onclick = () => abrirFicha(tr.dataset.ficha); });
};

// ── Pipeline ────────────────────────────────────────────────────────────────
VISOES.pipeline = async (el) => {
  const d = await api('/pipeline');
  el.innerHTML = `
    <div class="cabeca">
      <div>
        <div class="kicker">// PIPELINE</div>
        <h1 class="titulo">Oportunidades</h1>
        <p class="chamada">Arraste para mover de etapa. Toda oportunidade perdida exige motivo — é o dado que ensina o que corrigir.</p>
      </div>
    </div>
    <div class="kanban">
      ${d.etapas.map((c) => `
        <div class="coluna" data-etapa="${esc(c.etapa)}">
          <div class="coluna-topo">
            <span class="coluna-nome">${esc(ETAPAS[c.etapa] ?? c.etapa)}</span>
            <span class="coluna-total">${moeda(c.total)}</span>
          </div>
          ${c.itens.map((o) => `
            <div class="card-op" draggable="true" data-op="${esc(o.id)}" data-linha="${esc(o.id)}">
              <div class="t">${esc(o.titulo)}</div>
              <div class="c">${esc(o.cliente_nome ?? 'sem cliente')}</div>
              <div class="v">${moeda(o.valor_centavos)} <span style="color:var(--faint);font-weight:400">· ${esc(o.probabilidade)}%</span></div>
              ${o.motivo_perda ? `<div class="c" style="color:var(--crit);margin-top:5px">${esc(o.motivo_perda)}</div>` : ''}
              <select class="mover-etapa" data-mover="${esc(o.id)}"
                aria-label="Mover ${esc(o.titulo)} para outra etapa">
                ${Object.entries(ETAPAS).map(([k, v]) =>
    `<option value="${esc(k)}" ${k === o.etapa ? 'selected' : ''}>${esc(v)}</option>`).join('')}
              </select>
            </div>`).join('')}
        </div>`).join('')}
    </div>`;

  /*
   * Arrastar e soltar do HTML não tem equivalente por toque: no celular o
   * kanban virava um quadro de leitura. O seletor em cada cartão é o caminho
   * que funciona em tudo — dedo, mouse e teclado — e por isso ele existe no
   * desktop também, não só no celular.
   */
  async function mover(id, etapa) {
    const corpo = { etapa };
    if (etapa === 'perdido') {
      // Motivo estruturado, e não texto livre: "perdido por preço" e "perdido
      // por spam" são sinais opostos para o anúncio, e um campo aberto vira
      // trinta grafias da mesma coisa.
      // O titulo vem do dado ja carregado: quem arrastou tres cartoes seguidos
      // precisa saber QUAL esta respondendo.
      const op = (d.etapas ?? []).flatMap((c) => c.itens ?? []).find((x) => x.id === id);
      const r = await perguntar({
        contexto: op?.titulo ?? '',
        titulo: 'Por que a oportunidade foi perdida?',
        texto: 'O motivo alimenta o relatório e os públicos de anúncio — perdido por preço '
          + 'e perdido por sumiço não são o mesmo sinal.',
        campos: [{
          nome: 'motivo', tipo: 'opcoes',
          opcoes: [
            { valor: 'preco', rotulo: 'Preço' },
            { valor: 'prazo', rotulo: 'Prazo' },
            { valor: 'falta_peca', rotulo: 'Falta da peça' },
            { valor: 'concorrente', rotulo: 'Foi no concorrente' },
            { valor: 'sumiu', rotulo: 'Sumiu / não respondeu' },
            { valor: 'outro', rotulo: 'Outro' },
          ],
        }],
      });
      if (!r) return;
      const motivo = r.opcao;
      if (!motivo) { toast('Movimento cancelado', 'Perda exige motivo.', 'erro'); return false; }
      corpo.motivo_perda = motivo;
    }

    /*
     * Ganhar pede valor e número do pedido AQUI, com a pessoa na frente.
     *
     * Sem valor, o servidor recusa a venda — e antes desta caixa ele recusava
     * bem mais tarde, dentro do processamento de conversões, onde ninguém lê:
     * o evento mais valioso do funil era o mais fácil de perder em silêncio.
     *
     * O aviso de que não volta atrás não é dramatização: uma vez enviada, a
     * conversão entra no aprendizado do algoritmo da Meta e no relatório de
     * ROAS. Arrastar o cartão de volta depois não desfaz nada lá.
     */
    if (etapa === 'ganho') {
      const op = (d.etapas ?? []).flatMap((c) => c.itens ?? []).find((x) => x.id === id);
      const r = await perguntar({
        contexto: op?.titulo ?? '',
        titulo: 'Registrar venda fechada',
        texto: 'O valor vai para a Meta e o Google como conversão — é o que ensina a '
          + 'campanha a procurar mais gente como esta. Depois de enviada, ela não '
          + 'volta atrás por aqui.',
        campos: [
          {
            nome: 'valor', rotulo: 'Valor da venda (R$)', tipo: 'decimal',
            min: 0.01, max: 10000000, dica: 'ex.: 1.650,00',
            valor: op?.valor_centavos ? (op.valor_centavos / 100).toFixed(2).replace('.', ',') : '',
            obrigatorio: true,
            ajuda: 'Sem valor a conversão não ensina retorno — vira só mais um "converteu".',
          },
          {
            nome: 'pedido', rotulo: 'Número do pedido, contrato ou OS',
            valor: op?.pedido_ref ?? '', obrigatorio: true, dica: 'ex.: OS-02500',
            ajuda: 'É o que impede um reenvio de virar uma segunda venda no Gerenciador.',
          },
        ],
        confirmar: 'Registrar venda',
      });
      if (!r) return false;
      corpo.valor_centavos = Math.round(Number(r.valor) * 100);
      corpo.pedido_ref = r.pedido;
    }

    try {
      const r = await api(`/oportunidades/${id}`, { method: 'PATCH', corpo });
      if (r.eventoConversao) {
        toast('Etapa atualizada', `Gerou evento de conversão "${r.eventoConversao}" — veja em Conversões offline.`);
      }
      navegar();
      return true;
    } catch (e) {
      // Venda já contada não é erro de operação: é uma regra, e a pessoa
      // precisa entender POR QUE antes de tentar de novo. Um toast de três
      // segundos não cabe a explicação.
      if (e.codigo === 'venda_ja_contada') {
        await perguntar({
          contexto: 'Venda já enviada como conversão',
          titulo: 'Esta oportunidade não volta de etapa',
          texto: e.message,
          confirmar: 'Entendi',
          // Sem "Cancelar": nao ha decisao a tomar aqui, e oferecer duas
          // saidas para a mesma coisa e so mais uma escolha inutil.
          apenasCiencia: true,
        });
        return false;
      }
      toast('Não foi possível mover', e.message, 'erro');
      return false;
    }
  }

  el.querySelectorAll('[data-mover]').forEach((sel) => {
    const original = sel.value;
    sel.onchange = async () => {
      if (sel.value === original) return;
      const ok = await mover(sel.dataset.mover, sel.value);
      if (!ok) sel.value = original;
    };
    // Sem isto, escolher a etapa também "pega" o cartão para arrastar.
    sel.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  });

  let arrastando = null;
  el.querySelectorAll('[data-op]').forEach((c) => {
    c.ondragstart = () => { arrastando = c.dataset.op; c.style.opacity = '.4'; };
    c.ondragend = () => { c.style.opacity = ''; };
  });
  el.querySelectorAll('[data-etapa]').forEach((col) => {
    col.ondragover = (ev) => { ev.preventDefault(); col.classList.add('alvo'); };
    col.ondragleave = () => col.classList.remove('alvo');
    col.ondrop = async (ev) => {
      ev.preventDefault();
      col.classList.remove('alvo');
      if (!arrastando) return;
      const id = arrastando;
      arrastando = null;
      await mover(id, col.dataset.etapa);
    };
  });
};

// ── Catálogo ────────────────────────────────────────────────────────────────
VISOES.catalogo = async (el) => {
  const lista = await api('/catalogo');
  el.innerHTML = `
    <div class="cabeca"><div>
      <div class="kicker">// REFERÊNCIA</div>
      <h1 class="titulo">Catálogo</h1>
      <p class="chamada">Serviços e produtos com preço e ciclo de recompra — a fonte que a régua usa para saber quando falar de novo.</p>
    </div></div>
    <div class="tabela-caixa"><table>
      <thead><tr><th>SKU</th><th>Item</th><th>Categoria</th><th>Tipo</th><th class="num">Preço</th><th class="num">Ciclo</th></tr></thead>
      <tbody>${lista.map((i) => `
        <tr data-linha="${esc(i.id)}"><td style="font-family:var(--mono);font-size:12.5px">${esc(i.sku)}</td>
          <td class="forte">${esc(i.nome)}</td>
          <td class="fraco">${esc(i.categoria)}</td>
          <td><span class="tag">${esc(i.tipo)}</span></td>
          <td class="num">${moeda(i.preco_centavos)}</td>
          <td class="num">${i.ciclo_recompra_dias ? `${i.ciclo_recompra_dias}d` : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
};

// ── Gatilhos ────────────────────────────────────────────────────────────────
VISOES.gatilhos = async (el) => {
  const lista = await api('/gatilhos');
  el.innerHTML = `
    <div class="cabeca"><div>
      <div class="kicker">// CONFIGURAÇÃO</div>
      <h1 class="titulo">Gatilhos da régua</h1>
      <p class="chamada">
        A regra é código; o texto é dado. Dá para reescrever a mensagem sem tocar no sistema — as variáveis entre
        chaves são preenchidas na hora do envio.
      </p>
    </div></div>
    ${lista.map((g) => `
      <div class="cartao" style="margin-bottom:11px">
        <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:1;min-width:260px">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="forte" style="font-size:15px">${esc(g.nome)}</span>
              <span class="tag ${g.ativo ? 'ok' : 'crit'}">${g.ativo ? 'ativo' : 'desligado'}</span>
              <span class="tag">cooldown ${esc(g.cooldown_dias)}d</span>
            </div>
            <div class="fraco" style="margin-top:5px">${esc(g.descricao)}</div>
            <div class="contexto" style="margin-top:4px;color:var(--acento)">${esc(g.regra)}</div>
          </div>
          <button class="btn quiet sm" data-toggle="${esc(g.id)}" data-ativo="${g.ativo}">
            ${g.ativo ? 'Desligar' : 'Ligar'}
          </button>
        </div>
        <div class="mensagem" style="margin-top:12px">${esc(g.template)}</div>
      </div>`).join('')}`;

  el.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = async () => {
      await api(`/gatilhos/${b.dataset.toggle}`, {
        method: 'PATCH', corpo: { ativo: b.dataset.ativo !== '1' },
      });
      navegar();
    };
  });
};

// ── Disparos ────────────────────────────────────────────────────────────────
VISOES.disparos = async (el) => {
  const lista = await api('/disparos');
  const cores = { sent: 'ok', blocked: '', unknown: 'crit', failed: 'crit', claimed: 'warn' };
  el.innerHTML = `
    <div class="cabeca"><div>
      <div class="kicker">// SAÍDA</div>
      <h1 class="titulo">Histórico de disparos</h1>
      <p class="chamada">
        A intenção é gravada antes de tocar a rede. Por isso existe o estado <code style="font-family:var(--mono);color:var(--crit)">unknown</code>:
        quando a resposta é ambígua, o sistema não repete — chama um humano. Errar para "não repetir" custa uma
        mensagem atrasada; errar para o outro lado custa uma mensagem duplicada num cliente, e isso não se desfaz.
      </p>
    </div></div>
    ${lista.length ? `<div class="tabela-caixa"><table>
      <thead><tr><th>Quando</th><th>Cliente</th><th>Gatilho</th><th>Canal</th><th>Status</th><th>Motivo</th></tr></thead>
      <tbody>${lista.map((d) => `
        <tr><td class="fraco">${dataHora(d.criado_em)}</td>
          <td class="forte">${esc(d.cliente_nome)}</td>
          <td>${esc(d.gatilho_chave)}</td>
          <td class="fraco">${esc(CANAIS[d.canal_tipo] ?? d.canal_tipo)}</td>
          <td><span class="tag ${cores[d.status] ?? ''}">${esc(d.status)}</span></td>
          <td class="fraco">${esc(d.motivo ?? d.politica ?? '—')}</td></tr>`).join('')}
      </tbody></table></div>`
      : vazio({
      ic: '↗',
      titulo: 'Nenhum disparo registrado',
      texto: 'Este histórico se enche quando alguém dispara a fila. Cada linha guarda o '
        + 'que saiu, para quem e com qual decisão do compliance.',
      acoes: [{ rota: 'regua', rotulo: 'Ir para a fila de hoje' }],
      tranquilo: true,
    })}`;
};

// ── Visão do grupo ──────────────────────────────────────────────────────────
VISOES.grupo = async (el) => {
  const d = await api('/painel/grupo');
  el.innerHTML = `
    <div class="cabeca"><div>
      <div class="kicker">// CONSOLIDADO</div>
      <h1 class="titulo">Visão do grupo</h1>
      <p class="chamada">
        As empresas operam com marca, funil e atendimento independentes. A leitura consolidada atravessa a fronteira
        de propósito e por isso exige motivo declarado, que fica na auditoria.
      </p>
    </div></div>

    <div class="aviso">
      <strong>Motivo declarado desta leitura:</strong> ${esc(d.motivo)}
    </div>

    <div class="grade g4">
      <div class="cartao kpi acento"><div class="r">RECEITA DO GRUPO · 30D</div><div class="v ac">${moeda(d.consolidado.receita30d)}</div></div>
      <div class="cartao kpi"><div class="r">CLIENTES</div><div class="v">${numero(d.consolidado.clientes)}</div>
        <div class="n">${numero(d.consolidado.consentidos)} com consentimento</div></div>
      <div class="cartao kpi"><div class="r">VEÍCULOS</div><div class="v">${numero(d.consolidado.veiculos)}</div></div>
      <div class="cartao kpi"><div class="r">PIPELINE ABERTO</div><div class="v">${moeda(d.consolidado.pipelineAberto)}</div></div>
    </div>

    <h2 class="secao">Por empresa</h2>
    <div class="tabela-caixa"><table>
      <thead><tr><th>Empresa</th><th class="num">Clientes</th><th class="num">Consentidos</th>
        <th class="num">Veículos</th><th class="num">Receita 30d</th><th class="num">Pipeline aberto</th></tr></thead>
      <tbody>${d.empresas.map((e) => `
        <tr><td>
            <span class="empresa-cod" style="background:${esc(e.cor)};display:inline-grid;vertical-align:middle;margin-right:8px">${esc(e.codigo)}</span>
            <span class="forte">${esc(e.nome)}</span>
          </td>
          <td class="num">${numero(e.clientes)}</td>
          <td class="num">${numero(e.consentidos)}</td>
          <td class="num">${numero(e.veiculos)}</td>
          <td class="num">${moeda(e.receita_os_30d + e.receita_pedidos_30d)}</td>
          <td class="num">${moeda(e.pipeline_aberto)}</td></tr>`).join('')}
      </tbody></table></div>

    <div class="aviso" style="margin-top:20px">
      <strong>Como o isolamento funciona.</strong> Cada linha acima veio de uma consulta filtrada por empresa.
      Um operador da oficina não enxerga nada da fazenda — o servidor recusa a troca de empresa que não esteja
      no vínculo do usuário, e a interface nunca decide isso sozinha.
    </div>`;
};

// ── Auditoria ───────────────────────────────────────────────────────────────
VISOES.auditoria = async (el) => {
  const [linhas, v] = await Promise.all([api('/auditoria'), api('/auditoria/verificar')]);
  el.innerHTML = `
    <div class="cabeca"><div>
      <div class="kicker">// GOVERNANÇA</div>
      <h1 class="titulo">Auditoria</h1>
      <p class="chamada">Registro append-only encadeado por SHA-256. Cada linha carrega o hash da anterior.</p>
    </div></div>

    <div class="aviso ${v.integra ? 'ok' : 'crit'}">
      <strong>${v.integra ? 'Cadeia íntegra' : `${v.quebras.length} quebra(s) detectada(s)`}</strong>
      — ${numero(v.total)} registros verificados.
      <div style="color:var(--dim);margin-top:8px;font-size:12.5px">${esc(v.observacao)}</div>
    </div>

    <div class="tabela-caixa"><table>
      <thead><tr><th class="num">#</th><th>Quando</th><th>Ator</th><th>Ação</th><th>Entidade</th><th>Hash</th></tr></thead>
      <tbody>${linhas.map((l) => `
        <tr><td class="num fraco">${esc(l.seq)}</td>
          <td class="fraco">${dataHora(l.criado_em)}</td>
          <td>${esc(l.ator)}</td>
          <td class="forte">${esc(l.acao)}</td>
          <td class="fraco">${esc(l.entidade ?? '—')}</td>
          <td class="fraco" style="font-family:var(--mono);font-size:11px">${esc(String(l.hash).slice(0, 16))}…</td></tr>`).join('')}
      </tbody></table></div>`;
};

// ── Importação ──────────────────────────────────────────────────────────────
VISOES.importar = async (el) => {
  el.innerHTML = `
    <div class="cabeca"><div>
      <div class="kicker">// MIGRAÇÃO</div>
      <h1 class="titulo">Importar base de clientes</h1>
      <p class="chamada">
        Cole o CSV da base existente. Colunas reconhecidas: <code style="font-family:var(--mono)">nome</code>,
        <code style="font-family:var(--mono)">telefone</code>, <code style="font-family:var(--mono)">email</code>,
        <code style="font-family:var(--mono)">cidade</code>, <code style="font-family:var(--mono)">consentimento</code>.
      </p>
    </div></div>

    <div class="aviso warn">
      <strong>Regra de operação.</strong> Contato sem consentimento registrado entra na base como histórico, mas
      fica <strong>fora da régua</strong> até alguém coletar a autorização. A régua não é para onde se joga uma
      lista comprada — é para quem já falou com a empresa.
    </div>

    <div class="campo">
      <label>CSV (com cabeçalho na primeira linha)</label>
      <textarea id="csv" rows="12" placeholder="nome,telefone,email,cidade,consentimento
João da Silva,5538998112233,joao@exemplo.com,Januária,sim"
        style="font-family:var(--mono);font-size:12.5px"></textarea>
    </div>
    <button class="btn" id="importar">Importar</button>
    <div id="resultado" style="margin-top:18px"></div>`;

  el.querySelector('#importar').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const r = await api('/importar/clientes', {
        method: 'POST', corpo: { csv: el.querySelector('#csv').value },
      });
      el.querySelector('#resultado').innerHTML = `
        <div class="aviso ok">
          <strong>${numero(r.criados)} cliente(s) importado(s).</strong>
          ${r.duplicados ? `${numero(r.duplicados)} ignorado(s) por telefone já cadastrado.` : ''}
        </div>
        ${r.aviso ? `<div class="aviso warn">${esc(r.aviso)}</div>` : ''}`;
    } catch (e) {
      el.querySelector('#resultado').innerHTML = `<div class="aviso crit">${esc(e.message)}</div>`;
    }
    ev.currentTarget.disabled = false;
  };
};

// ── Telas de aquisição e central ────────────────────────────────────────────
// As telas recebem só o que usam. A lista explícita é o contrato: no dia em
// que ela crescer demais, é sinal de que a tela virou outra coisa.
const UI = {
  api, esc, moeda, numero, data, dataHora, toast, perguntar,
  abrirGaveta: (html) => abrirGaveta(html),
  navegar: () => navegar(),
};

VISOES.central = telaCentral(UI);
VISOES.conversoes = telaConversoes(UI);
VISOES.atribuicao = telaAtribuicao(UI);
VISOES.canais = telaCanais(UI);

// ── Manual ──────────────────────────────────────────────────────────────────
VISOES.manual = async (el) => {
  el.innerHTML = manualHtml(estado.empresa?.codigo);
  ligarManual(el, (rota) => { location.hash = rota; });
};

// ── Gaveta ──────────────────────────────────────────────────────────────────
/*
 * A gaveta vive na URL.
 *
 * Ideia tomada do CRM da Comp AI (MIT): "sheets, not inner pages" — a ficha é
 * uma gaveta identificada por um parâmetro, e não uma rota
 * `/clientes/:id/editar`. Três coisas que só funcionam por causa disso:
 *
 *   - o endereço é COMPARTILHÁVEL. "Olha a ficha do seu Antônio" vira um link,
 *     em vez de "abre Clientes, procura, clica";
 *   - o botão VOLTAR do navegador fecha a gaveta, que é o que qualquer pessoa
 *     espera. Antes ele saía da tela inteira, e no celular — onde voltar é um
 *     gesto — isso tirava o operador do trabalho;
 *   - recarregar a página reabre onde estava.
 *
 * O parâmetro fica DEPOIS da rota (`#/clientes?ficha=abc`), para a navegação
 * normal continuar lendo `#/clientes` sem saber que a gaveta existe.
 */
function abrirGaveta(html, { ficha = null } = {}) {
  fecharGaveta({ mexerNaUrl: false });

  const veu = document.createElement('div');
  veu.className = 'veu';
  veu.onclick = () => fecharGaveta();
  const g = document.createElement('aside');
  g.className = 'gaveta';
  g.setAttribute('role', 'dialog');
  g.setAttribute('aria-modal', 'true');
  g.innerHTML = html;
  document.body.append(veu, g);
  travarRolagem(true);
  g.querySelector('[data-fechar]')?.addEventListener('click', () => fecharGaveta());

  if (ficha) {
    const [rota] = location.hash.split('?');
    const alvo = `${rota}?ficha=${encodeURIComponent(ficha)}`;
    // `pushState`, e não trocar o hash: trocar o hash dispara `hashchange` e
    // faria a tela de trás recarregar por baixo da gaveta que acabou de abrir.
    if (location.hash !== alvo) history.pushState({ ficha }, '', alvo);
  }

  // Foco para dentro: sem isto o Tab continua percorrendo a lista atrás,
  // e quem usa teclado fica editando o que não está vendo.
  (g.querySelector('input, select, textarea, button') ?? g).focus?.();
}

function fecharGaveta({ mexerNaUrl = true } = {}) {
  const tinha = document.querySelector('.gaveta');
  document.querySelector('.veu')?.remove();
  tinha?.remove();
  // Só solta se havia mesmo uma gaveta: `fecharGaveta` é chamado às cegas
  // antes de abrir outra, e decrementar aí desequilibraria a conta.
  if (tinha) travarRolagem(false);

  if (tinha && mexerNaUrl && location.hash.includes('ficha=')) {
    const [rota] = location.hash.split('?');
    history.replaceState({}, '', rota);
  }
}

document.addEventListener('keydown', (e) => {
  // A busca trata o proprio Escape. Sem esta guarda, um Esc dentro da busca
  // fechava a ficha ATRAS dela — e a pessoa perdia o que estava lendo.
  if (e.key === 'Escape' && !buscaAberta) fecharGaveta();
});

/*
 * Voltar fecha a gaveta em vez de sair da tela.
 *
 * `popstate` cobre o botão do navegador e o gesto de voltar do celular. Se não
 * havia gaveta aberta, a navegação segue normal — o roteador cuida.
 */
window.addEventListener('popstate', () => {
  if (document.querySelector('.gaveta') && !location.hash.includes('ficha=')) {
    fecharGaveta({ mexerNaUrl: false });
  }
});

/** Reabre a ficha quando a URL já vem com `?ficha=` — link colado ou recarga. */
function restaurarGavetaDaUrl() {
  const q = location.hash.split('?')[1];
  if (!q) return;
  const id = new URLSearchParams(q).get('ficha');
  if (id && !document.querySelector('.gaveta')) abrirFicha(id);
}

// ── Início ──────────────────────────────────────────────────────────────────
(async function iniciar() {
  if (!estado.token) return renderLogin();
  try {
    const d = await api('/sessao');
    estado.usuario = d.usuario;
    estado.empresas = d.empresas;
    estado.demoMode = d.demoMode;
    estado.empresa = d.empresas.find((e) => e.instancia === localStorage.getItem('fortcrm.empresa')) ?? d.empresas[0];
    renderShell();
  } catch {
    renderLogin();
  }
})();
