FROM debian:bookworm-slim

# ---- Base + build toolchain + SSH server + locales ----
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        wget curl git ca-certificates \
        build-essential \
        python3 python3-pip \
        openssh-server \
        locales bash-completion \
        neofetch \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- UTF-8 locale (avoids warnings in git/node/etc.) ----
RUN sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen && \
    locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8

# ---- Node.js 24 (NodeSource) ----
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- ttyd: web terminal fallback (optional, own port) ----
RUN wget -qO /bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.3/ttyd.x86_64 && \
    chmod +x /bin/ttyd

# ---- SSH server (primary access for VS Code Remote-SSH) ----
RUN mkdir -p /run/sshd && \
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?UsePAM.*/UsePAM no/' /etc/ssh/sshd_config

ENV NODE_ENV=development \
    PATH="/usr/local/bin:${PATH}"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE $PORT

CMD ["/entrypoint.sh"]
