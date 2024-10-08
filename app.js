const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const port = 3001;

// Configuração do Banco de Dados
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "bdseubone",
  password: "4815",
  port: 5432,
});

// Middleware
app.use(cors());
app.use(express.json());

//Middleware para verficar se a requisição vem com token
const authenticateJWT = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];

  if (!token) {
    return res.sendStatus(403);
  }
  console.log(process.env.JWT_SECRET);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }

    req.user = user;
    next();
  });
};

// >>> Rota para obter o usuário logado e verificar se é superusuário
app.get("/api/users/loggedUser", authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      "SELECT id, username, role FROM usuarios WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Usuário não encontrado.");
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
    });
  } catch (err) {
    console.error(`Erro ao buscar usuário logado: ${err}`);
    res.status(500).send("Erro ao buscar usuário logado.");
  }
});

// >> Rota para obter os usuarios
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM usuarios");
    res.json(result.rows);
  } catch (err) {
    console.error(`Ocorreu um erro11: ${err}`);
    res.status(500).send("Erro ao buscar os usuarios");
  }
});

// >> Rota para registrar um novo usuário
app.post("/api/register", async (req, res) => {
  let { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send("Nome de usuário e senha são obrigatórios.");
  }

  username = username.toLowerCase();

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(
      "INSERT INTO Usuarios (username, senha) VALUES ($1, $2) RETURNING id",
      [username, hashedPassword]
    );

    res.status(201).json({ id: result.rows[0].id, username });
    console.log(result);
  } catch (err) {
    console.error(`Erro ao registrar usuário: ${err}`);
    res.status(500).send("Erro ao registrar usuário.");
  }
});

// >>> Rota para login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send("Nome de usuário e senha são obrigatórios.");
  }

  try {
    const result = await pool.query(
      "SELECT * FROM Usuarios WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).send("Não foi encontrado nenhum usuário");
    }

    const user = result.rows[0];

    // Comparar senhas
    const match = await bcrypt.compare(password, user.senha);
    if (!match) {
      return res.status(401).send("Credenciais inválidas.");
    }
    console.log(match);
    // Gerar o token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h", // O token expira em 1 hora
      }
    );

    res.json({ token });
  } catch (err) {
    console.error(`Erro ao fazer login: ${err}`);
    res.status(500).send("Erro ao fazer login.");
  }
});

// >>> Rota para obter todos os produtos
app.get("/api/produtos", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM Produtos");
    res.json(result.rows);
  } catch (err) {
    console.error(`Ocorreu um erro1: ${err}`);
    res.status(500).send("Erro ao buscar os produtos");
  }
});

// >>> Rota para obter todos as vendas
app.get("/api/vendas", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM vendas");
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar solicitações:", error);
    res.status(500).json({ error: "Erro ao buscar solicitações" });
  }
});

// >>> Rota para cadastrar ou solicitar uma venda
app.post("/api/vendas", async (req, res) => {
  const { cliente, tpPagamento, produtos, regiao, prazo, desconto } = req.body; // produtos é um array de { sku, quantidade }

  if (
    !cliente ||
    !tpPagamento ||
    !produtos ||
    !regiao ||
    !prazo ||
    desconto == undefined ||
    !Array.isArray(produtos) ||
    produtos.length === 0 ||
    produtos.some((p) => !p.sku || !p.quantidade)
  ) {
    return res.status(400).send("Dados da venda estão incompletos.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let somaDosProdutos = 0;

    // Calcular o subtotal dos produtos
    for (const produto of produtos) {
      const { sku, quantidade } = produto;

      // Validar se o produto existe e obter seu preço
      const produtoResult = await client.query(
        "SELECT preco_cheio, preco_descontado FROM Produtos WHERE sku = $1",
        [sku]
      );

      if (produtoResult.rows.length === 0) {
        throw new Error(`Produto com SKU ${sku} não encontrado.`);
      }

      const preco = parseFloat(
        tpPagamento == "0"
          ? produtoResult.rows[0].preco_cheio
          : produtoResult.rows[0].preco_descontado
      );

      const subtotal = preco * quantidade;
      somaDosProdutos += subtotal;
    }

    let frete = 0.0;
    if (regiao == "0") frete = 10;
    else if (regiao == "1") frete = 15;
    else if (regiao == "2") frete = 15;
    else if (regiao == "3") frete = 15;
    else if (regiao == "4") frete = 20;

    let adicional = 0;
    let descontoMaximo = 0;
    if (prazo === "0") {
      adicional = 0;
      descontoMaximo = Math.max(somaDosProdutos * 0.05, frete);
    } else if (prazo === "1") {
      adicional = somaDosProdutos * 0.1; //10% da soma dos produtos
      descontoMaximo = Math.max(somaDosProdutos * 0.1, frete);
    } else if (prazo === "2") {
      adicional = somaDosProdutos * 0.2; //20% da soma dos produtos
      descontoMaximo = Math.max(somaDosProdutos * 0.2, frete);
    }

    const valorTotalPedido = somaDosProdutos + frete + adicional - desconto;

    // Verifica se o desconto é maior que o máximo permitido
    if (desconto > descontoMaximo) {
      // Inserir na tabela Solicitações
      const solicitacaoResult = await client.query(
        "INSERT INTO solicitacoes (cliente, total, status) VALUES ($1, $2, $3) RETURNING id",
        [cliente, valorTotalPedido, "pendente"] // Assumindo um status padrão de 'pendente'
      );

      const idSolicitacao = solicitacaoResult.rows[0].id;

      console.log(
        `Venda registrada na tabela de solicitações. ID: ${idSolicitacao}`
      );

      await client.query("COMMIT");

      return res.status(201).json({
        mensagem:
          "A venda excedeu o valor de desconto máximo permito, será enviado uma solicitação, aguarde!",
        id: idSolicitacao,
        total_venda: valorTotalPedido,
      });
    }

    // Se o desconto estiver dentro do limite, registrar na tabela Vendas
    const vendaResult = await client.query(
      "INSERT INTO Vendas (cliente, total) VALUES ($1, $2) RETURNING id, data_venda",
      [cliente, valorTotalPedido]
    );

    // Atualiza o total na tabela Vendas
    await client.query("UPDATE Vendas SET total = $1 WHERE id = $2", [
      valorTotalPedido,
      vendaResult.rows[0].id,
    ]);

    await client.query("COMMIT");

    res.status(201).json({
      mensagem: "Venda registrada com sucesso!",
      venda_id: vendaResult.rows[0].id,
      data_venda: vendaResult.rows[0].data_venda,
      total_venda: valorTotalPedido,
      //const valorTotalPedido = somaDosProdutos + frete + adicional - desconto;
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Ocorreu um erro: ${err.message}`);
    res.status(500).send(`Erro ao registrar a venda: ${err.message}`);
  } finally {
    client.release();
  }
});

// >>> Rota para aceitar uma solicitação
app.put("/api/solicitacoes/:id", async (req, res) => {
  const { id } = req.params; // ID da solicitação
  const { status } = req.body; // Novo status (aceito ou negado)

  if (!status || (status !== "aceito" && status !== "negado")) {
    return res
      .status(400)
      .send("Status inválido. Deve ser 'aceito' ou 'negado'.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Atualiza o status da solicitação
    await client.query("UPDATE solicitacoes SET status = $1 WHERE id = $2", [
      status,
      id,
    ]);

    if (status === "aceito") {
      const solicitacaoResult = await client.query(
        "SELECT cliente, total FROM solicitacoes WHERE id = $1",
        [id]
      );

      if (solicitacaoResult.rows.length === 0) {
        throw new Error("Solicitação não encontrada.");
      }

      const { cliente, total } = solicitacaoResult.rows[0];

      // Inserir a venda na tabela Vendas
      const vendaResult = await client.query(
        "INSERT INTO Vendas (cliente, total) VALUES ($1, $2) RETURNING id, data_venda",
        [cliente, total]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        mensagem: "Solicitação aceita e venda registrada com sucesso!",
        venda_id: vendaResult.rows[0].id,
        data_venda: vendaResult.rows[0].data_venda,
      });
    }

    await client.query("COMMIT");

    res.status(200).json({
      mensagem: "Status da solicitação atualizado para 'negado'.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Ocorreu um erro: ${err.message}`);
    res
      .status(500)
      .send(`Erro ao atualizar o status da solicitação: ${err.message}`);
  } finally {
    client.release();
  }
});

// >>> Rota para listar solicitações
app.get("/api/solicitacoes", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM solicitacoes");
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar solicitações:", error);
    res.status(500).json({ error: "Erro ao buscar solicitações" });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta http://localhost:${port}/`);
});
