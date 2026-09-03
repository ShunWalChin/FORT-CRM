/**
 * Esquema do CRM multiempresas — protótipo.
 *
 * A fronteira do tenant é `empresa_id`, presente em TODA tabela de negócio.
 * O SQLite não tem RLS; aqui o isolamento é aplicado na camada de acesso
 * (src/db.mjs), que recusa consulta sem contexto de empresa. É uma imitação
 * honesta da doutrina, não o mesmo mecanismo: no Palantyr de produção quem
 * garante é o Postgres. Está registrado no README, "O que este protótipo não é".
 *
 * Dinheiro sempre em centavos (inteiro). Nunca float.
 * Vocabulário aberto: text + CHECK, nunca enum fechado.
 */

export const SCHEMA_SQL = `
pragma foreign_keys = on;

-- Tenant e pessoas ---------------------------------------------------------
create table if not exists empresas (
  id            text primary key,
  codigo        text not null unique,
  nome          text not null,
  segmento      text not null,
  cor           text not null default '#00b8c4',
  whatsapp      text,
  cidade        text,
  criado_em     text not null
);

create table if not exists usuarios (
  id            text primary key,
  nome          text not null,
  email         text not null unique,
  senha         text not null,
  papel         text not null default 'operador'
                check (papel in ('soberano','gestor','operador','leitura')),
  criado_em     text not null
);

create table if not exists memberships (
  usuario_id    text not null references usuarios(id) on delete cascade,
  empresa_id    text not null references empresas(id) on delete cascade,
  papel         text not null default 'operador',
  primary key (usuario_id, empresa_id)
);

-- Canais de mensageria -----------------------------------------------------
create table if not exists canais (
  id            text primary key,
  empresa_id    text not null references empresas(id) on delete cascade,
  tipo          text not null
                check (tipo in ('whatsapp_cloud','whatsapp_evolution','instagram','webchat')),
  nome          text not null,
  numero        text,
  conectado     integer not null default 1,
  criado_em     text not null
);
create index if not exists ix_canais_empresa on canais(empresa_id);

-- Base única de clientes ---------------------------------------------------
create table if not exists clientes (
  id                 text primary key,
  empresa_id         text not null references empresas(id) on delete cascade,
  nome               text not null,
  telefone           text,
  email              text,
  cidade             text,
  uf                 text,
  perfil             text not null default 'particular'
                     check (perfil in ('particular','frota','produtor_rural','revenda','consumidor')),
  origem             text not null default 'balcao',
  consentimento_lgpd integer not null default 0,
  consentimento_em   text,
  opt_out_em         text,
  ultimo_inbound_em  text,
  observacao         text,
  -- Campos que a empresa criou para si, num JSON so.
  --
  -- Nao e entidade-atributo-valor de proposito: mostrar uma lista com oito
  -- campos personalizados viraria oito juncoes, em toda pagina. Aqui os valores
  -- vem na MESMA linha que ja foi lida. O preco e nao haver integridade no
  -- valor, e e por isso que toda escrita passa por validarCampos() no servidor.
  campos             text not null default '{}',
  criado_em          text not null
);
create index if not exists ix_clientes_empresa on clientes(empresa_id);
create index if not exists ix_clientes_tel on clientes(empresa_id, telefone);

-- Frota e veículos (Minas Peças) -------------------------------------------
create table if not exists veiculos (
  id                text primary key,
  empresa_id        text not null references empresas(id) on delete cascade,
  cliente_id        text not null references clientes(id) on delete cascade,
  placa             text not null,
  marca             text,
  modelo            text,
  ano               integer,
  motorizacao       text,
  sistema_injecao   text not null default 'common_rail_cp3'
                    check (sistema_injecao in
                      ('common_rail_cp3','common_rail_cp4','bomba_mecanica',
                       'bomba_rotativa','uis_ups','injecao_eletronica')),
  km_ultima         integer,
  horimetro         integer,
  media_km_mes      integer not null default 0,
  ultima_visita_em  text,
  criado_em         text not null
);
create index if not exists ix_veiculos_empresa on veiculos(empresa_id);
create unique index if not exists ux_veiculos_placa on veiculos(empresa_id, placa);

-- Ordens de serviço --------------------------------------------------------
create table if not exists ordens_servico (
  id              text primary key,
  empresa_id      text not null references empresas(id) on delete cascade,
  cliente_id      text not null references clientes(id) on delete cascade,
  veiculo_id      text references veiculos(id) on delete set null,
  numero          text not null,
  componente      text not null,
  bancada         text,
  pressao_bar     integer,
  resultado_laudo text,
  peca_aplicada   text,
  valor_centavos  integer not null default 0,
  garantia_meses  integer not null default 3,
  km_servico      integer,
  status          text not null default 'aberta'
                  check (status in ('aberta','em_bancada','concluida','cancelada')),
  aberta_em       text not null,
  concluida_em    text
);
create index if not exists ix_os_empresa on ordens_servico(empresa_id);
create unique index if not exists ux_os_numero on ordens_servico(empresa_id, numero);

-- Catálogo -----------------------------------------------------------------
create table if not exists catalogo (
  id                   text primary key,
  empresa_id           text not null references empresas(id) on delete cascade,
  sku                  text not null,
  nome                 text not null,
  categoria            text not null,
  tipo                 text not null default 'servico' check (tipo in ('servico','produto')),
  preco_centavos       integer not null default 0,
  ciclo_recompra_dias  integer,
  ativo                integer not null default 1
);
create index if not exists ix_catalogo_empresa on catalogo(empresa_id);
create unique index if not exists ux_catalogo_sku on catalogo(empresa_id, sku);

-- Pedidos (Agrofort) -------------------------------------------------------
create table if not exists pedidos (
  id                  text primary key,
  empresa_id          text not null references empresas(id) on delete cascade,
  cliente_id          text not null references clientes(id) on delete cascade,
  numero              text not null,
  canal               text not null default 'whatsapp',
  valor_centavos      integer not null default 0,
  itens               text not null default '[]',
  status              text not null default 'entregue'
                      check (status in ('novo','separacao','enviado','entregue','cancelado')),
  ciclo_recompra_dias integer not null default 30,
  feito_em            text not null,
  proximo_contato_em  text
);
create index if not exists ix_pedidos_empresa on pedidos(empresa_id);
create unique index if not exists ux_pedidos_numero on pedidos(empresa_id, numero);

-- Pipeline -----------------------------------------------------------------
create table if not exists oportunidades (
  id             text primary key,
  empresa_id     text not null references empresas(id) on delete cascade,
  cliente_id     text references clientes(id) on delete set null,
  titulo         text not null,
  etapa          text not null default 'novo'
                 check (etapa in ('novo','qualificado','orcamento','negociacao','ganho','perdido')),
  valor_centavos integer not null default 0,
  probabilidade  integer not null default 20,
  posicao        real not null default 1000,
  motivo_perda   text,
  criado_em      text not null,
  atualizado_em  text not null
);
create index if not exists ix_op_empresa on oportunidades(empresa_id, etapa);

-- Régua de contato ---------------------------------------------------------
create table if not exists gatilhos (
  id                text primary key,
  empresa_id        text not null references empresas(id) on delete cascade,
  chave             text not null,
  nome              text not null,
  descricao         text not null,
  regra             text not null,
  antecedencia_dias integer not null default 0,
  cooldown_dias     integer not null default 30,
  template          text not null,
  ativo             integer not null default 1
);
create unique index if not exists ux_gatilhos on gatilhos(empresa_id, chave);

-- Saída idempotente --------------------------------------------------------
-- Estados do Palantyr: claimed, sent, blocked, unknown, failed.
-- unknown e claimed nunca recebem retry automático.
create table if not exists disparos (
  id              text primary key,
  empresa_id      text not null references empresas(id) on delete cascade,
  cliente_id      text not null references clientes(id) on delete cascade,
  gatilho_chave   text not null,
  canal_tipo      text not null,
  corpo           text not null,
  status          text not null
                  check (status in ('claimed','sent','blocked','unknown','failed')),
  politica        text,
  motivo          text,
  idempotency_key text not null,
  criado_em       text not null
);
create unique index if not exists ux_disparos_idem on disparos(empresa_id, idempotency_key);
create index if not exists ix_disparos_empresa on disparos(empresa_id, criado_em);

-- Atividades ---------------------------------------------------------------
-- Registro de propriedades: descreve TANTO as colunas reais quanto as chaves
-- dentro de clientes.campos.
--
-- E o que faz "acrescentar um campo ao CRM" ser uma linha de dado em vez de
-- alteracao em quatro lugares: formulario, tabela, filtro e ficha leem daqui.
--
-- Linha de sistema (origem='sistema') descreve coluna real e tem chave e tipo
-- IMUTAVEIS — mudar isso nao renomeia a coluna, so faz o registro mentir.
create table if not exists propriedades (
  id                text primary key,
  empresa_id        text not null references empresas(id) on delete cascade,
  entidade          text not null default 'cliente',
  origem            text not null default 'custom' check (origem in ('sistema','custom')),
  chave             text not null,
  rotulo            text not null,
  tipo              text not null,
  opcoes            text,
  descricao         text,
  obrigatorio       integer not null default 0,
  mostrar_na_tabela integer not null default 0,
  ordem             integer not null default 100,
  arquivado_em      text,
  criado_em         text not null,
  unique (empresa_id, entidade, chave)
);
create index if not exists ix_prop_ent on propriedades (empresa_id, entidade, arquivado_em);

create table if not exists atividades (
  id          text primary key,
  empresa_id  text not null references empresas(id) on delete cascade,
  cliente_id  text not null references clientes(id) on delete cascade,
  tipo        text not null,
  descricao   text not null,
  criado_em   text not null
);
create index if not exists ix_ativ_cliente on atividades(empresa_id, cliente_id, criado_em);

-- Auditoria append-only com cadeia SHA-256 ---------------------------------
create table if not exists audit_log (
  seq           integer primary key autoincrement,
  empresa_id    text,
  ator          text not null,
  acao          text not null,
  entidade      text,
  entidade_id   text,
  dados         text not null default '{}',
  hash_anterior text,
  hash          text not null,
  criado_em     text not null
);

create trigger if not exists trg_audit_no_update
before update on audit_log
begin select raise(abort, 'audit_log e append-only'); end;

create trigger if not exists trg_audit_no_delete
before delete on audit_log
begin select raise(abort, 'audit_log e append-only'); end;
`;
