/**
 * Esquema do ERP — e a decisão de arquitetura que ele carrega.
 *
 * ═══ O conflito ═══
 *
 * A propriedade que define este sistema é o isolamento físico: cada empresa num
 * banco separado, e nenhuma consulta capaz de atravessar. A central existia
 * como PROJEÇÃO DE LEITURA — nunca fonte de verdade, e livre para estar velha.
 *
 * Um ERP é o oposto disso. Contas a pagar não pode ser projeção velha: paga-se
 * duas vezes. Um razão contábil precisa de partida dobrada dentro de UMA
 * transação, e não existe transação que atravesse três arquivos SQLite —
 * `emCada` roda instância por instância e engole a falha de cada uma num campo
 * de texto. Metade escrita é, em dinheiro, pior do que nada escrito.
 *
 * ═══ A saída ═══
 *
 * A central deixa de ser só projeção e passa a ser FONTE DE VERDADE DO GRUPO,
 * para as coisas do grupo. As instâncias continuam donas do que é delas.
 * A direção do dado é a regra, e ela é de mão única em cada sentido:
 *
 *   PARA BAIXO (central manda)  — plano de contas, centros de custo, parceiros,
 *   períodos contábeis, pessoas. São definições do grupo; ter três versões
 *   divergentes de "conta 4.1.01" é não ter plano de contas nenhum.
 *
 *   PARA CIMA (instância manda) — fatos consumados: a venda fechou, a OS
 *   entregou, a nota entrou. A instância é a dona do fato; a central acumula.
 *
 *   NUNCA — a central editar o registro operacional de uma instância. O dia em
 *   que a Central puder mexer na ordem de serviço da oficina, o isolamento
 *   virou enfeite.
 *
 * Por isso o razão inteiro mora AQUI, num arquivo só: um lançamento é uma
 * transação local, e a partida dobrada fecha ou não acontece.
 *
 * ═══ As seis invariantes ═══
 *
 *   1. Todo lançamento soma zero: Σ débitos = Σ créditos.
 *   2. Período fechado não recebe lançamento.
 *   3. Lançamento não se edita — estorna-se, e o estorno é outro lançamento.
 *   4. Conta sintética não recebe partida; só folha do plano.
 *   5. Título não se baixa além do saldo.
 *   6. Nenhum dinheiro se move sem lançamento: toda baixa gera o seu.
 *
 * Elas não são comentário: cada uma tem teste, e o razão recusa a escrita que
 * as fira. É o que "inquebrável" significa aqui — não que nada falhe, mas que
 * a falha não deixe o livro inconsistente.
 */

export const SCHEMA_ERP_SQL = `
-- ═══ Dimensões do grupo ══════════════════════════════════════════════════
--
-- A "instância" é a empresa: MP, AF, FT. Existe também GRUPO, para o que é do
-- holding e não de nenhuma delas — rateio de software, contabilidade, o
-- salário de quem atende as três.
create table if not exists erp_empresas (
  codigo      text primary key,
  nome        text not null,
  documento   text,
  operacional integer not null default 1,
  criada_em   text not null
);

/*
 * Plano de contas.
 *
 * "codigo" hierárquico por ponto (1.1.01.001) e "pai" explícito: a hierarquia
 * derivada só do texto quebra no dia em que alguém cria "1.10" — que ordena
 * entre "1.1" e "1.2" alfabeticamente e no lugar errado numericamente.
 *
 * "aceita_lancamento" separa sintética de analítica. Lançar em conta sintética
 * é o erro que destrói o balancete sem dar erro nenhum.
 */
create table if not exists erp_contas (
  codigo            text primary key,
  nome              text not null,
  tipo              text not null
                    check (tipo in ('ativo','passivo','patrimonio','receita','despesa')),
  -- Natureza do saldo: devedora ou credora. Decide o sinal no balancete.
  natureza          text not null check (natureza in ('D','C')),
  pai               text references erp_contas(codigo),
  aceita_lancamento integer not null default 1,
  ativa             integer not null default 1,
  criada_em         text not null
);
create index if not exists ix_conta_pai on erp_contas(pai);

create table if not exists erp_centros_custo (
  codigo    text primary key,
  nome      text not null,
  instancia text not null,
  setor     text check (setor in ('comercial','marketing','financeiro','rh','ti','operacao','administrativo')),
  ativo     integer not null default 1,
  criado_em text not null
);

/*
 * Período contábil.
 *
 * Sem ele não há contabilidade, só uma lista de valores: é o fechamento que
 * transforma lançamentos em resultado do mês. Fechado, o período recusa
 * qualquer escrita — inclusive estorno, que passa a ser lançado no período
 * seguinte, como manda a prática.
 */
create table if not exists erp_periodos (
  competencia text primary key,          -- 'AAAA-MM'
  status      text not null default 'aberto' check (status in ('aberto','fechado')),
  aberto_em   text not null,
  fechado_em  text,
  fechado_por text,
  -- Resumo congelado no fechamento, para o BI não recalcular o passado.
  resultado_centavos integer,
  receita_centavos   integer,
  despesa_centavos   integer
);

-- ═══ Razão ═══════════════════════════════════════════════════════════════
--
-- O lançamento é o cabeçalho; as partidas são as pernas. Nunca se altera:
-- "estorna" aponta para o lançamento que este desfaz, e "estornado_por" é
-- preenchido no original. Duas colunas em vez de um update no valor — o
-- histórico contábil é a única defesa real numa auditoria.
create table if not exists erp_lancamentos (
  id            text primary key,
  instancia     text not null,
  competencia   text not null references erp_periodos(competencia),
  data          text not null,
  historico     text not null,
  origem        text not null default 'manual'
                check (origem in ('manual','venda','ordem_servico','titulo','baixa','rateio','abertura','estorno')),
  origem_ref    text,
  criado_por    text not null,
  criado_em     text not null,
  estorna       text references erp_lancamentos(id),
  estornado_por text references erp_lancamentos(id)
);
create index if not exists ix_lanc_comp on erp_lancamentos(competencia, instancia);
create index if not exists ix_lanc_origem on erp_lancamentos(origem, origem_ref);

create table if not exists erp_partidas (
  id             text primary key,
  lancamento_id  text not null references erp_lancamentos(id) on delete cascade,
  conta          text not null references erp_contas(codigo),
  centro_custo   text references erp_centros_custo(codigo),
  tipo           text not null check (tipo in ('D','C')),
  -- Sempre positivo. O sinal é o "tipo"; valor negativo num débito seria a
  -- mesma coisa que um crédito, e passaria a existir duas formas de escrever
  -- o mesmo fato — que é como um livro deixa de bater consigo mesmo.
  valor_centavos integer not null check (valor_centavos > 0),
  ordem          integer not null default 0
);
create index if not exists ix_part_lanc on erp_partidas(lancamento_id);
create index if not exists ix_part_conta on erp_partidas(conta);

-- ═══ Parceiros, contas a pagar e a receber ═══════════════════════════════
create table if not exists erp_parceiros (
  id         text primary key,
  tipo       text not null check (tipo in ('fornecedor','cliente','ambos','colaborador')),
  nome       text not null,
  documento  text,
  instancia  text,                       -- nulo = do grupo inteiro
  email      text,
  telefone   text,
  ativo      integer not null default 1,
  criado_em  text not null
);
create index if not exists ix_parc_doc on erp_parceiros(documento);

/*
 * Título: uma obrigação com data.
 *
 * "saldo_centavos" é redundante com a soma das baixas — e é redundância
 * deliberada. A pergunta "o que vence esta semana" é a mais feita do
 * financeiro, e respondê-la varrendo as baixas de todo título aberto piora a
 * cada mês que o sistema roda. O razão continua sendo a verdade; este campo é
 * conveniência, e o teste confere que os dois concordam.
 */
create table if not exists erp_titulos (
  id             text primary key,
  instancia      text not null,
  natureza       text not null check (natureza in ('pagar','receber')),
  parceiro_id    text references erp_parceiros(id),
  numero         text,
  descricao      text not null,
  emissao        text not null,
  vencimento     text not null,
  valor_centavos integer not null check (valor_centavos > 0),
  saldo_centavos integer not null,
  status         text not null default 'aberto'
                 check (status in ('aberto','parcial','quitado','cancelado')),
  conta          text references erp_contas(codigo),
  centro_custo   text references erp_centros_custo(codigo),
  lancamento_id  text references erp_lancamentos(id),
  origem         text,
  origem_ref     text,
  criado_por     text not null,
  criado_em      text not null
);
create index if not exists ix_tit_venc on erp_titulos(status, vencimento);
create index if not exists ix_tit_inst on erp_titulos(instancia, natureza, status);

create table if not exists erp_baixas (
  id             text primary key,
  titulo_id      text not null references erp_titulos(id),
  data           text not null,
  valor_centavos integer not null check (valor_centavos > 0),
  meio           text not null default 'pix'
                 check (meio in ('dinheiro','pix','debito','credito','boleto','transferencia','compensacao')),
  conta_caixa    text references erp_contas(codigo),
  lancamento_id  text not null references erp_lancamentos(id),
  criado_por     text not null,
  criado_em      text not null
);
create index if not exists ix_baixa_tit on erp_baixas(titulo_id);

-- ═══ Pessoas ═════════════════════════════════════════════════════════════
--
-- O mínimo para o RH existir como setor e para o custo de pessoal chegar ao
-- razão pelo centro de custo certo. Folha de pagamento NÃO está aqui: ela é
-- legislação, e legislação mal implementada é passivo, não recurso.
create table if not exists erp_colaboradores (
  id            text primary key,
  instancia     text not null,
  nome          text not null,
  documento     text,
  cargo         text,
  setor         text check (setor in ('comercial','marketing','financeiro','rh','ti','operacao','administrativo')),
  centro_custo  text references erp_centros_custo(codigo),
  admissao      text,
  desligamento  text,
  salario_centavos integer,
  usuario_email text,
  ativo         integer not null default 1,
  criado_em     text not null
);
create index if not exists ix_colab_inst on erp_colaboradores(instancia, ativo);

-- ═══ Permissão por módulo ════════════════════════════════════════════════
--
-- A escala linear (leitura < operador < gestor < soberano) não descreve um
-- ERP: "vê RH mas não vê Financeiro" não é um degrau, é outro eixo. Esta
-- tabela é ortogonal à escala — quem passa pela escala ainda precisa da
-- concessão do módulo.
create table if not exists erp_permissoes (
  usuario_email text not null,
  modulo        text not null
                check (modulo in ('financeiro','contas_pagar','contas_receber','rh','ti','comercial','marketing','bi','razao','admin')),
  nivel         text not null default 'ler' check (nivel in ('ler','escrever','administrar')),
  concedido_por text not null,
  concedido_em  text not null,
  primary key (usuario_email, modulo)
);

-- Fatos que subiram das instâncias, com a marca de quando. Não é o razão:
-- é a fila de onde o razão se alimenta, e o que permite reprocessar sem
-- duplicar (a chave é a origem, não o instante da leitura).
create table if not exists erp_fatos (
  id            text primary key,
  instancia     text not null,
  tipo          text not null,
  ref           text not null,
  payload       text not null default '{}',
  ocorrido_em   text not null,
  lido_em       text not null,
  lancamento_id text references erp_lancamentos(id),
  unique (instancia, tipo, ref)
);
create index if not exists ix_fato_pendente on erp_fatos(lancamento_id, ocorrido_em);
`;
