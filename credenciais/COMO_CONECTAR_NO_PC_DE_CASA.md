# 🔑 Como Conectar na Máquina Oracle pelo PC de Casa

Este arquivo contém o backup seguro da chave SSH de acesso ao servidor Oracle Cloud do **PXT Player**.

---

### 1. Senha do Arquivo ZIP
O arquivo `chave-oracle-ssh.zip` está protegido e criptografado.
- **Senha:** `171220`

---

### 2. Passo a Passo no Computador de Casa

1. **Baixar o repositório ou o arquivo ZIP:**
   - No GitHub, baixe o repositório ou apenas o arquivo `credenciais/chave-oracle-ssh.zip`.
2. **Extrair a chave:**
   - Dê dois cliques em `chave-oracle-ssh.zip` (com o WinRAR, 7-Zip ou Windows Explorer).
   - Digite a senha **`171220`**.
   - Extraia o arquivo `ssh-key-oracle.key` para uma pasta de sua escolha (ex: `C:\Users\SeuUsuario\`).

3. **Conectar pelo Terminal (PowerShell / CMD):**
   - Abra o **PowerShell** ou Prompt de Comando e cole o comando abaixo (ajustando o caminho onde você salvou a chave):
   ```bash
   ssh -i "C:\caminho\onde\salvou\ssh-key-oracle.key" ubuntu@137.131.218.79
   ```

---

### 3. Dados da Máquina Oracle
- **IP do Servidor:** `137.131.218.79`
- **Usuário SSH:** `ubuntu`
- **Porta Web:** `80` (HTTP)
- **Pasta dos Arquivos do Player:** `/var/www/html/`
- **Comando para reiniciar o Nginx (se necessário):** `sudo systemctl restart nginx`
