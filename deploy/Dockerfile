# =============================================================================
# FORT-CRM — imagem de execução.
#
# Node 24 DENTRO do contêiner, de propósito.
#
# O host (<IP-DO-SERVIDOR>) roda Node 22.22.2, e `node:sqlite` só existe sem flag
# a partir do 23.4 — a aplicação sobe e morre no primeiro `import`. A saída
# óbvia seria atualizar o Node do host, e é exatamente o que NÃO se faz num
# servidor com vinte contêineres de clientes: qualquer coisa que dependa do
# runtime do sistema quebraria junto, e o sintoma apareceria noutro serviço.
#
# Aqui o runtime pertence à aplicação. O host não muda.
#
# Sem `npm install`: o sistema não tem dependência nenhuma. Isso significa
# imagem pequena, build de segundos e nada de árvore de pacotes para auditar.
# =============================================================================
FROM node:24-alpine

# Usuário sem privilégio. A imagem `node` já traz o uid 1000 `node`.
WORKDIR /app

# Só o que a aplicação precisa para rodar. `data/` e `export/` ficam de fora —
# os dados moram em volume, e o export é artefato de desenvolvimento.
COPY --chown=node:node server.mjs ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node web/ ./web/
# Scripts operacionais, rodados por timer ou `docker exec`: manutenção (backup
# com VACUUM INTO e reancoragem) e definição de senhas. Só os .mjs — Dockerfile,
# compose e config do túnel não têm o que fazer dentro do contêiner.
COPY --chown=node:node deploy/*.mjs ./deploy/

# Diretório de dados, montado como volume em produção.
RUN mkdir -p /dados/instancias && chown -R node:node /dados

USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4310 \
    FORTCRM_DIR=/dados/instancias

# `HOST=0.0.0.0` aqui é seguro e necessário: é o endereço DENTRO do contêiner.
# Quem restringe a superfície é a publicação da porta no compose, que amarra em
# 127.0.0.1 do host. Sem isto o processo só escutaria no loopback do contêiner
# e o Docker não conseguiria encaminhar nada.
EXPOSE 4310

# Prova de vida real: pede uma resposta da API, não só um processo vivo.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4310/api/sessao',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
