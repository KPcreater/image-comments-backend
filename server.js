require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3000;
const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

if (!SHOP || !TOKEN) {
  console.error("Error: Missing Shopify Store or Admin Token in environment variables.");
  process.exit(1);
}

const graphqlEndpoint = `https://${SHOP}/admin/api/2024-01/graphql.json`;
const headers = {
  'X-Shopify-Access-Token': TOKEN,
  'Content-Type': 'application/json',
};

app.use(cors());
app.use(bodyParser.json());

app.post("/apps/comments/save", async (req, res) => {
  const { image_id, comment } = req.body;

  if (!image_id || !comment) {
    return res.status(400).json({ error: "Missing image_id or comment in request body." });
  }

  const timestamp = new Date().toISOString();
  const handle = `comment-${image_id}-${Date.now()}`;

  const mutation = `
    mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
          fields {
            key
            value
          }
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const variables = {
    metaobject: {
      type: "image_comment",
      handle: handle,
      fields: [
        { key: "image_id", value: image_id.toString() },
        { key: "comment_text", value: comment },
        { key: "timestamp", value: timestamp }
      ],
      capabilities: {
        publishable: {
          status: "ACTIVE"
        }
      }
    }
  };

  try {
    const response = await axios.post(graphqlEndpoint, { query: mutation, variables }, { headers });
    const responseData = response.data;
    const userErrors = responseData?.data?.metaobjectCreate?.userErrors;

    if (userErrors && userErrors.length > 0) {
       return res.status(400).json({
        error: "Failed to save comment due to validation errors.",
        details: userErrors
      });
    }

    if (responseData.errors) {
        return res.status(400).json({
          error: "Failed to save comment due to GraphQL errors.",
          details: responseData.errors
        });
    }

    if (!responseData?.data?.metaobjectCreate?.metaobject) {
        return res.status(500).json({ error: "Internal Server Error: Unexpected response structure after saving comment." });
    }

    res.json({ success: true, data: responseData.data.metaobjectCreate });

  } catch (err) {
    if (err.response) {
       res.status(err.response.status || 500).json({
         error: "Error communicating with Shopify API while saving.",
         details: err.response.data
        });
    } else if (err.request) {
       res.status(500).json({ error: "Internal Server Error: No response from Shopify API." });
    } else {
      res.status(500).json({ error: "Internal Server Error.", details: err.message });
    }
  }
});


app.get("/apps/comments/get", async (req, res) => {
  const { image_id } = req.query;

  if (!image_id) {
    return res.status(400).json({ error: "Missing image_id query parameter." });
  }

  const query = `
    query GetMetaobjectsByImageId($filterQuery: String!) {
      metaobjects(type: "image_comment", first: 100, query: $filterQuery) {
        nodes {
          id
          fields {
            key
            value
          }
        }
      }
    }
  `;

  const variables = {
    filterQuery: `image_id:'${image_id}'`
  };

  try {
    const response = await axios.post(graphqlEndpoint, { query, variables }, { headers });
    const responseData = response.data;

     if (responseData.errors) {
      return res.status(400).json({
        error: "Failed to get comments due to GraphQL errors.",
        details: responseData.errors
      });
    }

    const nodes = responseData?.data?.metaobjects?.nodes || [];
    const comments = nodes.map(node => {
      const commentField = node.fields.find(f => f.key === "comment_text");
      return commentField ? commentField.value : null;
    }).filter(comment => comment !== null);

    res.json({ comments });

  } catch (err) {
     if (err.response) {
       res.status(err.response.status || 500).json({
         error: "Error communicating with Shopify API while fetching.",
         details: err.response.data
        });
    } else if (err.request) {
       res.status(500).json({ error: "Internal Server Error: No response from Shopify API." });
    } else {
      res.status(500).json({ error: "Internal Server Error.", details: err.message });
    }
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); // Kept essential startup log
