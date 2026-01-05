![Debian](https://img.shields.io/badge/Debian-Bookworm-d70751?logo=debian)
![Docker](https://img.shields.io/badge/Docker-Supported-blue?logo=docker)

# Debian-Railway

Want to try out Debian or want to have a mini version of Debian available at all times? Then feel free to give this project a try:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/O5JpUW?referralCode=zkQBwB)

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

## Deploy

Click the deploy button above to deploy this template to Railway. The deployment process is automatic and takes just a few minutes.

## Host

This service will be accessible via the Railway-provided domain after deployment. You can also configure a custom domain in Railway settings.

## Why Deploy

- Quick access to a Debian terminal from anywhere
- No local installation required
- Perfect for testing and learning
- Lightweight and fast

## Common Use Cases

- Testing shell scripts
- Learning Linux commands
- Remote development environment
- Package testing

## Dependencies for Deployment

- Docker (handled by Railway)
- Railway account

### Deployment Dependencies

This template automatically installs:
- wget
- curl
- git
- python3
- python3-pip
- neofetch
- ttyd

## About Hosting

Railway provides free tier hosting with:
- $1 free credit monthly
- Automatic HTTPS
- Custom domains support
- Easy environment variable management
