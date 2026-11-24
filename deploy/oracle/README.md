# Postline cloud standby (Oracle Always Free)

The home PC stays the main bridge. This copy sleeps (no browser running) while the PC is alive and takes over about 90 seconds
after the PC goes silent; when the PC comes back it hands over within ~30 seconds. Requests already handled are never repeated,
and push tokens + contacts are carried across. The two copies coordinate through one encrypted CloudKit record (`pl-lease`).

## 1. Make the server (once, in the browser)
1. cloud.oracle.com -> sign up (Always Free; a card is asked for identity only). Pick the home region carefully, it cannot change.
2. Compute -> Instances -> Create instance: image **Ubuntu 24.04**, shape **Ampere A1 Flex, 1 OCPU / 6 GB** (Always Free).
   If it says "out of capacity", try again later; the 1 GB AMD micro shape is too small for Chromium.
3. Let Oracle generate the SSH key and **download the private key** (e.g. `oracle.key`). Create the instance and note its public IP.

## 2. On the PC
```powershell
node deploy/oracle/pack-secrets.mjs                     # writes ~/Desktop/postline-secrets.tar.gz (keys; keep private)
scp -i oracle.key $HOME\Desktop\postline-secrets.tar.gz ubuntu@<VM-IP>:~/
del $HOME\Desktop\postline-secrets.tar.gz
ssh -i oracle.key ubuntu@<VM-IP> "git clone https://github.com/theprojectmaker/postline-ios.git postline && bash postline/deploy/oracle/setup.sh"
```

## 3. Sign in to Gmail once (through an SSH tunnel)
```powershell
ssh -i oracle.key -L 6080:localhost:6080 ubuntu@<VM-IP> "bash ~/postline/deploy/oracle/login.sh"
```
Open http://localhost:6080/vnc.html, click Connect, sign in to the school Gmail, wait for the inbox, then press Ctrl+C in the terminal.

## 4. Start it
```powershell
ssh -i oracle.key ubuntu@<VM-IP> "sudo systemctl enable --now postline-bridge; tail -5 ~/postline/bridge/bridge.log"
```
It should log `standby: the PC is alive, staying idle`. To test: stop the PC bridge and watch it take over in ~90 s.

## Notes
- If Google signs the account out (it may treat a data-centre address as unusual), the service stops (exit 2) rather than looping;
  repeat step 3 and `sudo systemctl start postline-bridge`.
- Update later: `ssh ... "cd ~/postline && git pull && sudo systemctl restart postline-bridge"`.
