![Debian](https://img.shields.io/badge/Debian-Bookworm-d70751?logo=debian)
![Docker](https://img.shields.io/badge/Docker-Supported-blue?logo=docker)

# Debian-Railway

Want to try out Debian or want to have a mini version of Debian available at all times? Then feel free to give this project a try:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/O5JpUW?referralCode=zkQBwB&utm_medium=integration&utm_source=template&utm_campaign=generic)

## Description

This project uses the official [Debian Bookworm](https://hub.docker.com/_/debian) slim image to deploy a container which can then be used to install most of the CLI tools. Behind the scenes, it uses [ttyd](https://github.com/tsl0922/ttyd) to provide a hassle-free and a very accessible way to access the command line.

### Features
- 🐧 Official Debian Bookworm Slim base
- 🔒 Password-protected web terminal
- 💻 Neofetch display on login

## Environment Variables

- **PORT:** The port on which the ttyd program will listen on.
- **USERNAME:** The username which will be used to login to the web shell.
- **PASSWORD:** The password which will be used to login to the web shell.

**NOTE:** It is strongly advised to provide the USERNAME and PASSWORD environment variables before deploying the project.
