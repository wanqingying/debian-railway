![Debian](https://img.shields.io/badge/Debian-Bookworm-d70751?logo=debian)
![Docker](https://img.shields.io/badge/Docker-Supported-blue?logo=docker)

# Debian-Railway

Want to try out Debian or want to have a mini version of Debian available at all times? Then feel free to give this project a try:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/template/YOUR_TEMPLATE_ID?referralCode=YOUR_CODE)

## Description

This project uses the official [Debian Bookworm](https://hub.docker.com/_/debian) slim image to deploy a container which can then be used to install most of the CLI tools. Behind the scenes, it uses [ttyd](https://github.com/tsl0922/ttyd) to provide a hassle-free and a very accessible way to access the command line.

### Features
- 🐧 Official Debian Bookworm Slim base
- 🔒 Password-protected web terminal
- 📦 Pre-installed with Python 3, Git, Curl, Wget
- 💻 Neofetch display on login

## Environment Variables

- **PORT:** The port on which the ttyd program will listen on.
- **USERNAME:** The username which will be used to login to the web shell.
- **PASSWORD:** The password which will be used to login to the web shell.

**NOTE:** It is strongly advised to provide the USERNAME and PASSWORD environment variables before deploying the project.

## Installation

1. Click the "Deploy on Railway" button above
2. Set your USERNAME and PASSWORD in the environment variables
3. Wait for deployment to complete
4. Access your Debian terminal via the provided Railway URL

## Usage

After deployment, you can:
- Install any packages using `apt install`
- Run scripts and programs
- Use it as a development environment
- Access it from anywhere via web browser

## Default Packages

The following packages are pre-installed:
- `wget` - File downloader
- `curl` - URL transfer tool
- `git` - Version control system
- `python3` - Python programming language
- `python3-pip` - Python package installer
- `neofetch` - System information tool

## License

This project uses open-source software:
- [Debian](https://www.debian.org/) - Licensed under Debian Free Software Guidelines
- [ttyd](https://github.com/tsl0922/ttyd) - MIT License
