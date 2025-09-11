#!/bin/bash

# Installation script for Hyperliquid Monitor systemd service

SERVICE_NAME="hyperliquid-monitor"
SERVICE_FILE="$SERVICE_NAME.service"
INSTALL_DIR="/home/awang/tmp/hyper/node"

echo "Installing Hyperliquid Node Trade Monitor as systemd service..."
echo "=============================================================="

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "Please run this script with sudo"
    exit 1
fi

# Check if service file exists
if [ ! -f "$INSTALL_DIR/$SERVICE_FILE" ]; then
    echo "Error: Service file not found at $INSTALL_DIR/$SERVICE_FILE"
    exit 1
fi

# Check if .env file exists
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo "Error: .env file not found. Please configure it first."
    exit 1
fi

# Build the application
echo "Building application..."
cd $INSTALL_DIR
npm install --production
npm run build

# Copy service file
echo "Copying service file..."
cp $SERVICE_FILE /etc/systemd/system/

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable service
echo "Enabling service..."
systemctl enable $SERVICE_NAME

# Start service
echo "Starting service..."
systemctl start $SERVICE_NAME

# Check status
echo ""
echo "Service status:"
systemctl status $SERVICE_NAME --no-pager

echo ""
echo "Installation complete!"
echo ""
echo "Useful commands:"
echo "  View logs: sudo journalctl -u $SERVICE_NAME -f"
echo "  Stop service: sudo systemctl stop $SERVICE_NAME"
echo "  Start service: sudo systemctl start $SERVICE_NAME"
echo "  Restart service: sudo systemctl restart $SERVICE_NAME"
echo "  Check status: sudo systemctl status $SERVICE_NAME"
