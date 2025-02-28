# BedRock Chatbot CDK

Once CDK deployment is done, make a post request to the Lambda functional URL with following payload:

```
{
    "agentId": "XXX",
    "agentAliasId": "XXX",
    "sessionId": "[UUID]",
    "prompt": "yo"
}
```

Note that using Lambda functional URL is for demo only. Use a secured API endpoint for production.

## Pinecone

Please sign up for a free account from Pinecone:
https://www.pinecone.io/blog/amazon-bedrock-integration/