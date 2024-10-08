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

const authenticateJWT = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];

  if (!token) {
    return res.sendStatus(403); // Proibido
  }
  console.log(process.env.JWT_SECRET);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // Proibido
    }

    req.user = user;
    next();
  });
};

// >> Rota para obter usuario
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM usuarios");
    res.json(result.rows);
  } catch (err) {
    console.error(`Ocorreu um erro11: ${err}`);
    res.status(500).send("Erro ao buscar os usuarios");
  }
});

// >>> Rota para registrar um novo usuário
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send("Nome de usuário e senha são obrigatórios.");
  }

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

  console.log(password);

  try {
    const result = await pool.query(
      "SELECT * FROM Usuarios WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).send("Não foi encontrado nenhum usuário");
    }

    const user = result.rows[0];
    console.log(user);

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

// >>> Rota para obter todas as vendas com detalhes dos produtos
app.get("/api/vendas", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        v.id AS venda_id,
        v.cliente,
        v.data_venda,
        v.total,
        vp.sku,
        p.produto,
        vp.quantidade,
        (vp.quantidade * p.preco_cheio) AS subtotal
      FROM Vendas v
      JOIN Venda_Produtos vp ON v.id = vp.venda_id
      JOIN Produtos p ON vp.sku = p.sku
      ORDER BY v.id, vp.id;
    `);
    // Agrupar produtos por venda
    const vendas = {};
    result.rows.forEach((row) => {
      if (!vendas[row.venda_id]) {
        vendas[row.venda_id] = {
          id: row.venda_id,
          cliente: row.cliente,
          data_venda: row.data_venda,
          total_venda: parseFloat(row.total),
          produtos: [],
        };
      }
      vendas[row.venda_id].produtos.push({
        sku: row.sku,
        produto: row.produto,
        quantidade: row.quantidade,
        preco: parseFloat(row.preco_cheio),
        subtotal: parseFloat(row.subtotal),
      });
    });
    res.json(Object.values(vendas));
  } catch (err) {
    console.error(`Ocorreu um erro2: ${err}`);
    res.status(500).send("Erro ao buscar as vendas");
  }
});

// >>> Rota para adicionar uma nova venda
app.post("/api/vendas", async (req, res) => {
  const { cliente, tpPagamento, produtos, regiao, prazo, desconto } = req.body; // produtos é um array de { sku, quantidade }

  // Validação dos dados da requisição
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

    // Inserir a venda na tabela Vendas
    const vendaResult = await client.query(
      "INSERT INTO Vendas (cliente, total) VALUES ($1, $2) RETURNING id, data_venda",
      [cliente, 0.0] // Inicialmente total é 0.00, será atualizado depois
    );

    const vendaId = vendaResult.rows[0].id;

    let somaDosProdutos = 0;

    // Inserir cada produto da venda na tabela Venda_Produtos
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

      if (isNaN(preco)) {
        throw new Error("O preço calculado é inválido.");
      }

      const subtotal = preco * quantidade;
      somaDosProdutos += subtotal;

      // Inserir na tabela Venda_Produtos
      await client.query(
        "INSERT INTO Venda_Produtos (venda_id, sku, quantidade) VALUES ($1, $2, $3)",
        [vendaId, sku, quantidade]
      );
    }

    let frete = 0.0;
    if (regiao == "0") {
      //nordeste
      frete = 10;
    } else if (regiao == "1") {
      //norte
      frete = 15;
    } else if (regiao == "2") {
      //sudeste
      frete = 15;
    } else if (regiao == "3") {
      //centro-oeste
      frete = 15;
    } else if (regiao == "4") {
      //sum
      frete = 20;
    }

    let adicional = 0;
    let descontoMaximo = 0;
    if (prazo === "0") {
      // normal
      adicional = 0;
      descontoMaximo = Math.max(somaDosProdutos * 0.05, frete);
    } else if (prazo === "1") {
      // Turbo
      adicional = somaDosProdutos * 0.1;
      descontoMaximo = Math.max(somaDosProdutos * 0.1, frete);
    } else if (prazo === "2") {
      // Super Turbo
      adicional = somaDosProdutos * 0.2;
      descontoMaximo = Math.max(somaDosProdutos * 0.2, frete);
    }

    console.log(somaDosProdutos);
    console.log(frete);
    console.log(adicional);
    console.log(desconto);
    const valorTotalPedido = somaDosProdutos + frete + adicional - desconto;
    console.log(valorTotalPedido);
    console.log(descontoMaximo);

    if (desconto > descontoMaximo) {
      return res
        .status(400)
        .send(
          `O desconto excede o máximo permitido de ${descontoMaximo.toFixed(
            2
          )}.`
        );
    }

    // Atualizar o campo 'total' na tabela Vendas
    await client.query("UPDATE Vendas SET total = $1 WHERE id = $2", [
      valorTotalPedido,
      vendaId,
    ]);

    await client.query("COMMIT");

    res.status(201).json({
      mensagem: "Venda registrada com sucesso!",
      venda_id: vendaId,
      data_venda: vendaResult.rows[0].data_venda,
      total_venda: valorTotalPedido,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Ocorreu um erro3: ${err.message}`);
    res.status(500).send(`Erro ao registrar a venda: ${err.message}`);
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta http://localhost:${port}/`);
});
