const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

const graphqlEndpoint = `https://${SHOP}/admin/api/2023-10/graphql.json`;
const headers = {
  'X-Shopify-Access-Token': TOKEN,
  'Content-Type': 'application/json',
};

// Save Comment to Metaobject
app.post("/apps/comments/save", async (req, res) => {
  const { image_id, comment } = req.body;

  const mutation = `
  mutation {
    metaobjectCreate(metaobject: {
      type: "image_comment",
      handle: "comment-${Date.now()}",
      fields: [
        { key: "image_id", value: "${image_id}" },
        { key: "comment_text", value: """${comment}""" },
        { key: "timestamp", value: "${new Date().toISOString()}" }
      ],
      capabilities: {
        publishable: {
          status: DRAFT
        }
      }
    }) {
      metaobject {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;


  try {
    const response = await axios.post(graphqlEndpoint, { query: mutation }, { headers });
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Comments for an Image
app.get("/apps/comments/get", async (req, res) => {
  const { image_id } = req.query;

  const query = `
    query {
      metaobjects(type: "image_comment", first: 100, query: "image_id:${image_id}") {
        nodes {
          fields {
            key
            value
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(graphqlEndpoint, { query }, { headers });
    const nodes = response.data.data.metaobjects.nodes;
    const comments = nodes.map(node => {
      const text = node.fields.find(f => f.key === "image_comment.comment_text")?.value;
      return text;
    });
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
