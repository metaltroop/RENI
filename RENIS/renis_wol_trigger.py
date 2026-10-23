#!/usr/bin/env python3
"""
RENIS Wake-on-LAN (WoL) Trigger Utility
Transmits standard Magic Packets (AMD magic packet format: 6x 0xFF followed by 16x target MAC)
to wake the remote host over the local broadcast domain.
"""

import os
import sys
import argparse
import socket
import re
from typing import Optional, List, Tuple
from pathlib import Path

# Try loading dotenv if present
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

NITRO_WOL_BANNER = r"""
  _  _ _____ _____ ___  ___   __      _____  _     
 | \| |_   _|_   _| _ \/ _ \  \ \    / / _ \| |    
 | .` | | |   | | |   / (_) |  \ \/\/ / (_) | |__  
 |_|\_| |_|   |_| |_|_\\___/    \_/\_/ \___/|____| 
   >> RENIS MAGIC PACKET TRANSMITTER v1.0.0 <<
"""

def clean_mac(mac_str: str) -> str:
    """Normalizes MAC address string into 12 hex digits."""
    cleaned = re.sub(r'[^a-fA-F0-9]', '', mac_str)
    if len(cleaned) != 12:
        raise ValueError(f"Invalid MAC address: '{mac_str}'. Expected 12 hexadecimal characters.")
    return cleaned.upper()

def build_magic_packet(mac_cleaned: str) -> bytes:
    """Constructs a 102-byte Magic Packet."""
    mac_bytes = bytes.fromhex(mac_cleaned)
    return (b'\xff' * 6) + (mac_bytes * 16)

def send_magic_packet(
    mac_address: str,
    broadcast_ip: str = "255.255.255.255",
    port: int = 9
) -> bool:
    """
    Broadcasts a Magic Packet via UDP to wake the target computer.
    """
    try:
        cleaned = clean_mac(mac_address)
        packet = build_magic_packet(cleaned)
        
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.sendto(packet, (broadcast_ip, port))
            
        formatted_mac = ":".join(cleaned[i:i+2] for i in range(0, 12, 2))
        print(f"[+] [NITRO-WOL] Magic packet transmitted successfully to {formatted_mac} via {broadcast_ip}:{port}")
        return True
    except Exception as e:
        print(f"[-] [NITRO-WOL] Failed to send Magic Packet: {e}", file=sys.stderr)
        return False

def get_local_interfaces() -> List[Tuple[str, str, str]]:
    """Returns a list of local (interface_name, ip_address, mac_address) tuples."""
    results = []
    try:
        import psutil
        nics = psutil.net_if_addrs()
        for nic_name, addrs in nics.items():
            ip = "N/A"
            mac = "N/A"
            for addr in addrs:
                if addr.family == socket.AF_INET:
                    ip = addr.address
                elif hasattr(socket, "AF_LINK") and addr.family == socket.AF_LINK:
                    mac = addr.address
                elif getattr(addr, 'family', None) == -1: # Windows MAC fallback
                    mac = addr.address
            if mac != "N/A" and mac.replace("-", "").replace(":", ""):
                results.append((nic_name, ip, mac))
    except Exception as err:
        print(f"[!] Warning reading interfaces: {err}")
    return results

def main():
    print(NITRO_WOL_BANNER)
    parser = argparse.ArgumentParser(description="RENIS Wake-on-LAN Magic Packet Broadcaster")
    parser.add_argument("--mac", "-m", help="Target MAC address (e.g., 00:11:22:33:44:55)", 
                        default=os.getenv("RENIS_TARGET_MAC"))
    parser.add_argument("--ip", "-i", help="Broadcast IP (default: 255.255.255.255)", 
                        default=os.getenv("RENIS_BROADCAST_IP", "255.255.255.255"))
    parser.add_argument("--port", "-p", type=int, help="Target UDP port (default: 9)", 
                        default=int(os.getenv("RENIS_WOL_PORT", "9")))
    parser.add_argument("--info", action="store_true", help="Display local network interfaces and MAC addresses")
    
    args = parser.parse_args()
    
    if args.info:
        print("[*] Local Network Interfaces & Discovered Hardware MACs:")
        for nic, ip, mac in get_local_interfaces():
            print(f"    - {nic:25} | IP: {ip:16} | MAC: {mac}")
        return

    target_mac = args.mac
    if not target_mac or target_mac == "00:00:00:00:00:00":
        print("[-] Target MAC address is required. Use --mac <MAC> or set RENIS_TARGET_MAC in .env.")
        print("[*] Running with --info to display candidate MAC addresses on this machine:\n")
        for nic, ip, mac in get_local_interfaces():
            print(f"    - {nic:25} | IP: {ip:16} | MAC: {mac}")
        sys.exit(1)

    success = send_magic_packet(target_mac, broadcast_ip=args.ip, port=args.port)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
