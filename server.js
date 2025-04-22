require('dotenv').config(); // Load environment variables first
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// --- Configuration ---
const PORT = process.env.PORT || 3000; // Use Render's port or default to 3000
const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

if (!SHOP || !TOKEN) {
  console.error("Error: Missing Shopify Store or Admin Token in environment variables.");
  process.exit(1); // Stop the server if config is missing
}

const graphqlEndpoint = `https://${SHOP}/admin/api/2024-01/graphql.json`; // Use a stable API version or update as needed
const headers = {
  'X-Shopify-Access-Token': TOKEN,
  'Content-Type': 'application/json',
};

// --- Middleware ---
app.use(cors()); // Enable CORS for requests from your Shopify frontend
app.use(bodyParser.json()); // Parse JSON request bodies

// --- Routes ---

/**
 * POST /apps/comments/save
 * Saves a new comment as a Metaobject entry.
 */
app.post("/apps/comments/save", async (req, res) => {
  const { image_id, comment } = req.body;

  if (!image_id || !comment) {
    return res.status(400).json({ error: "Missing image_id or comment in request body." });
  }

  const timestamp = new Date().toISOString();
  const handle = `comment-${image_id}-${Date.now()}`; // Make handle slightly more unique

  // Use GraphQL variables for safety and clarity
  const mutation = `
    mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
          fields { # Return fields for confirmation if needed
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
      type: "image_comment", // Ensure this matches your Metaobject Definition handle
      handle: handle,
      fields: [
        { key: "image_id", value: image_id.toString() }, // Store as string
        { key: "comment_text", value: comment },
        { key: "timestamp", value: timestamp }
      ],
      // Status can be ACTIVE or DRAFT. DRAFT won't show on storefronts if access is enabled.
      // Choose based on whether you need an approval step.
      capabilities: {
        publishable: {
          status: "ACTIVE" // Or "DRAFT"
        }
      }
    }
  };

  console.log(`Attempting to save comment for image_id: ${image_id}`); // Add logging

  try {
    const response = await axios.post(graphqlEndpoint, { query: mutation, variables }, { headers });

    const responseData = response.data; // Keep reference

    // Check for GraphQL-level errors returned in the response body
    const userErrors = responseData?.data?.metaobjectCreate?.userErrors;
    if (userErrors && userErrors.length > 0) {
      console.error("GraphQL UserErrors (Save):", JSON.stringify(userErrors, null, 2));
      return res.status(400).json({
        error: "Failed to save comment due to validation errors.",
        details: userErrors
      });
    }

    // Check for top-level GraphQL errors
    if (responseData.errors) {
        console.error("GraphQL Errors (Save):", JSON.stringify(responseData.errors, null, 2));
        return res.status(400).json({
          error: "Failed to save comment due to GraphQL errors.",
          details: responseData.errors
        });
    }

    // Check if metaobject data is present (it should be on success)
    if (!responseData?.data?.metaobjectCreate?.metaobject) {
        console.error("Unexpected Success Response (Save): Missing metaobject data.", JSON.stringify(responseData, null, 2));
        return res.status(500).json({ error: "Internal Server Error: Unexpected response structure after saving comment." });
    }

    console.log(`Successfully saved comment for image_id: ${image_id}, Handle: ${responseData.data.metaobjectCreate.metaobject.handle}`);
    res.json({ success: true, data: responseData.data.metaobjectCreate }); // Send back the created object details

  } catch (err) {
    console.error("--- Error Saving Comment ---");
    console.error("Request Body:", req.body); // Log what was received
    console.error("Axios/Network Error (Save):", err.message);
    if (err.response) {
      // Log the detailed error response from Shopify if available
      console.error("Shopify Error Response Status (Save):", err.response.status);
      console.error("Shopify Error Response Data (Save):", JSON.stringify(err.response.data, null, 2));
      res.status(err.response.status || 500).json({
         error: "Error communicating with Shopify API while saving.",
         details: err.response.data
        });
    } else if (err.request) {
       // The request was made but no response was received
       console.error("No response received (Save):", err.request);
       res.status(500).json({ error: "Internal Server Error: No response from Shopify API." });
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up request (Save):', err.message);
      res.status(500).json({ error: "Internal Server Error.", details: err.message });
    }
    console.error("--- End Error Saving Comment ---");
  }
});

/**
 * GET /apps/comments/get
 * Retrieves comments for a specific image_id.
 */
app.get("/apps/comments/get", async (req, res) => {
  const { image_id } = req.query;

  if (!image_id) {
    return res.status(400).json({ error: "Missing image_id query parameter." });
  }

  // Use GraphQL variables
  // Note: The 'query' argument for metaobjects expects a specific string format.
  // Ensure the `image_id` field in your metaobject definition is marked as filterable!
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
    filterQuery: `image_id:'${image_id}'` // Construct the filter string value
  };

  console.log(`Attempting to get comments for image_id: ${image_id}`); // Add logging

  try {
    const response = await axios.post(graphqlEndpoint, { query, variables }, { headers });

    const responseData = response.data; // Keep reference

    // Check for top-level GraphQL errors
     if (responseData.errors) {
      console.error("GraphQL Errors (Get):", JSON.stringify(responseData.errors, null, 2));
      // Check for specific filter error
       if (responseData.errors.some(e => e.message?.includes('filter is not supported'))) {
           console.error(">>> Filtering Error: Make sure the 'image_id' field in the 'image_comment' Metaobject Definition is set as 'Use field as filter' in Shopify Admin! <<<");
           return res.status(400).json({
             error: "Failed to get comments: Filtering not enabled for image_id.",
             details: responseData.errors
           });
       }
      return res.status(400).json({
        error: "Failed to get comments due to GraphQL errors.",
        details: responseData.errors
      });
    }

    // Safely access nodes and map comments
    const nodes = responseData?.data?.metaobjects?.nodes || [];
    const comments = nodes.map(node => {
      // Correctly find the 'comment_text' field by its key
      const commentField = node.fields.find(f => f.key === "comment_text");
      return commentField ? commentField.value : null; // Return the value if found
    }).filter(comment => comment !== null); // Filter out any potential nulls if a node was missing the field

    console.log(`Found ${comments.length} comments for image_id: ${image_id}`);
    res.json({ comments }); // Send just the array of comment strings

  } catch (err) {
    console.error("--- Error Getting Comments ---");
    console.error("Request Query:", req.query); // Log what was received
    console.error("Axios/Network Error (Get):", err.message);
     if (err.response) {
      console.error("Shopify Error Response Status (Get):", err.response.status);
      console.error("Shopify Error Response Data (Get):", JSON.stringify(err.response.data, null, 2));
       res.status(err.response.status || 500).json({
         error: "Error communicating with Shopify API while fetching.",
         details: err.response.data
        });
    } else if (err.request) {
       console.error("No response received (Get):", err.request);
       res.status(500).json({ error: "Internal Server Error: No response from Shopify API." });
    } else {
      console.error('Error setting up request (Get):', err.message);
      res.status(500).json({ error: "Internal Server Error.", details: err.message });
    }
     console.error("--- End Error Getting Comments ---");
  }
});

// --- Start Server ---
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
