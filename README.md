# **Bedrock Agent Chatbot CDK**

This project deploys an AWS CDK stack that includes a **Lambda function** for interacting with Amazon Bedrock using `InvokeAgentCommand`.

## **Making a Request**
Once the **CDK deployment** is complete, send a `POST` request to the **Lambda Function URL** using the following payload.

### **Example using `httpie`**
```sh
http --stream POST "https://xxxx.lambda-url.us-east-1.on.aws/" \
     agentId="XXX" agentAliasId="XXX" sessionId="xxx" prompt="tell me about iPhone"
```

---

## **Pinecone Integration**
To use **Pinecone** for vector search, sign up for a free account:  
🔗 [Pinecone + Amazon Bedrock Integration](https://www.pinecone.io/blog/amazon-bedrock-integration/)

---

## **Notes on `InvokeAgentCommand` with Streaming (Not Working as of 2025-03-06)**
Amazon Bedrock’s `InvokeAgentCommand` **supports streaming**, but streaming responses **may not work** under certain conditions.

🔗 [AWS SDK Docs: `InvokeAgentCommand`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-agent-runtime/command/InvokeAgentCommand/)

### **Streaming Configuration**
To enable streaming, set:
```ts
streamingConfigurations: {
    streamFinalResponse: true
},
```
You have to use [lambda-stream library](https://github.com/astuyve/lambda-stream) for handling streamed responses.

### **Lambda Requirements**
To support response streaming, the Lambda function must:
- **Use a functional URL** for direct invocation with security consequences.
- Be configured with:  
  ```ts
  invokeMode: lambda.InvokeMode.RESPONSE_STREAM
  ```
- Have the **`bedrock:InvokeModelWithResponseStream`** IAM permission.
- Use a **Bedrock model that supports streaming.**

---

## **Known Issues**
Currently, some users report that **streaming is not working**.  
Refer to the following discussions for potential solutions:
- 🔗 [AWS RePost Issue](https://repost.aws/questions/QUgntPWmqxQDuXENGc97hyvQ/calling-invokeagentcommand-from-bedrock-agent-runtime-returns-only-trace-chunks-no-data-chunks-but-the-trace-chunks-contain-the-response-which-would-have-been-in-the-data-chunks-why)
- 🔗 [Stack Overflow Discussion](https://stackoverflow.com/questions/79473938/aws-bedrock-agent-unable-to-get-invokeagent-to-stream-response-even-after-sett)