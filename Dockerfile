FROM debian:bookworm-slim

# update & install package dasar
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y wget curl git python3 python3-pip neofetch && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# download ttyd prebuilt
RUN wget -qO /bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.3/ttyd.x86_64 && \
    chmod +x /bin/ttyd

# jalankan neofetch tiap login
RUN echo "neofetch" >> /root/.bashrc

# expose port Railway
EXPOSE $PORT

# debug optional
RUN echo $CREDENTIAL > /tmp/debug

# set custom PS1 prompt dengan username dari variable dan start ttyd
CMD ["/bin/bash", "-c", "\
    echo \"export PS1='\\[\\033[01;31m\\]$USERNAME@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '\" >> /root/.bashrc && \
    /bin/ttyd -p $PORT -c $USERNAME:$PASSWORD /bin/bash"]
