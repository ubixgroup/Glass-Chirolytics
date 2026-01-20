#!/bin/bash

# script to generate locally-trusted certificates for development.
# enables network access to the app from other devices on the same network.

# check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "mkcert is not installed. please install it first:"
    echo "  brew install mkcert nss (on macos with homebrew)"
    echo "  or visit https://github.com/FiloSottile/mkcert for other installation methods"
    exit 1
fi

# create certificates directory if it doesn't exist
CERT_DIR="certificates"
mkdir -p $CERT_DIR

# install local ca if not already installed
echo "installing local ca (may require password)..."
mkcert -install

# get the local ip address
IP_ADDRESS=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)

if [ -z "$IP_ADDRESS" ]; then
    echo "couldn't detect ip address, using localhost only"
    DOMAINS="localhost 127.0.0.1 ::1"
else
    echo "detected ip address: $IP_ADDRESS"
    DOMAINS="localhost 127.0.0.1 ::1 $IP_ADDRESS"
fi

# generate certificates for localhost and the detected ip
echo "generating certificates for: $DOMAINS"
mkcert -key-file $CERT_DIR/key.pem -cert-file $CERT_DIR/cert.pem $DOMAINS

echo "certificates generated in $CERT_DIR directory"
echo "key: $CERT_DIR/key.pem"
echo "cert: $CERT_DIR/cert.pem"
echo ""
echo "these certificates are now trusted by your system and browser"
echo "you can now use https://localhost:5173 and https://$IP_ADDRESS:5173 without warnings" 