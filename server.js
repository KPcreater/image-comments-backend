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
    const responseData = response.data;

    // ... (add check for responseData.errors here as before) ...

    const nodes = responseData?.data?.metaobjects?.nodes || [];
    console.log(`---> Found ${nodes.length} metaobject nodes for image_id: ${image_id}`); // Log how many nodes

    const comments = nodes.map((node, index) => {
        // *** ADD THIS LOGGING ***
        console.log(`---> Processing Node ${index} Fields:`, JSON.stringify(node.fields, null, 2));

        const commentField = node.fields.find(f => f.key === "comment_text"); // Use the EXACT key from Shopify Admin here

        if (!commentField) {
            console.log(`---> Node ${index}: Field with key "comment_text" NOT FOUND.`); // Log if not found
        } else {
             console.log(`---> Node ${index}: Field "comment_text" FOUND. Value: "${commentField.value}"`); // Log if found
        }

        return commentField ? commentField.value : null;
    }); // Removed the .filter() temporarily to see nulls if they occur

    console.log(`---> Mapped comments (before filtering):`, comments);

    // Filter out nulls before sending the response
    const filteredComments = comments.filter(comment => comment !== null);

    res.json({ comments: filteredComments }); // Send the filtered array

} catch (err) {
  // ... (existing error handling) ...
}
});

// --- Start Server ---
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
