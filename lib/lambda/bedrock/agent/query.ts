import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentRequest,
  ResponseStream,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { streamifyResponse } from "lambda-stream";

const client = new BedrockAgentRuntimeClient({});

export const handler = streamifyResponse(
  async (event: APIGatewayProxyEventV2, responseStream: NodeJS.WritableStream, context?: Context) => {
    console.log("Received event:", event.body);

    const agentId = process.env.AGENT_ID;
    const agentAliasId = process.env.AGENT_ALIAS_ID;

    if (!agentId || !agentAliasId) {
      console.error("Agent ID or Agent Alias ID is not configured.");
      responseStream.write(JSON.stringify({ message: "Agent ID or Agent Alias ID is not configured." }));
      responseStream.end();
      return;
    }

    try {
      if (!event.body) {
        console.error("Invalid input, missing request body");
        responseStream.write(JSON.stringify({ message: "Error: Missing request body." }));
        responseStream.end();
        return;
      }

      const request = JSON.parse(event.body);
      const { sessionAttributes, promptSessionAttributes, sessionId, prompt } = request;

      if (!prompt) {
        console.error("Invalid input, missing required field: prompt");
        responseStream.write(JSON.stringify({ message: "Error: Missing required field: prompt." }));
        responseStream.end();
        return;
      }

      const input: InvokeAgentRequest = {
        sessionState: {
          sessionAttributes: sessionAttributes || {},
          promptSessionAttributes: promptSessionAttributes || {},
        },
        agentId,
        agentAliasId,
        sessionId,
        inputText: prompt,
        streamingConfigurations: {
          streamFinalResponse: true,
        },
        bedrockModelConfigurations: {
          performanceConfig: { latency: "standard" },
        },
      };

      console.log("Invoking Bedrock Agent with input:", input);

      const command = new InvokeAgentCommand(input);
      const response = await client.send(command);

      if (!response.completion) {
        console.error("Completion stream is undefined");
        responseStream.write(JSON.stringify({ message: "Error: Bedrock response is missing the completion stream." }));
        responseStream.end();
        return;
      }

      for await (const chunkEvent of response.completion as AsyncIterable<ResponseStream>) {
        if (chunkEvent.chunk) {
          const decodedChunk = new TextDecoder("utf-8").decode(chunkEvent.chunk.bytes);
          console.log("Streaming chunk:", decodedChunk);
          responseStream.write(decodedChunk);
        }
      }

      responseStream.end();
    } catch (error) {
      console.error("Error invoking Bedrock Agent:", error);
      responseStream.write(JSON.stringify({ message: `Error: ${error instanceof Error ? error.message : "Internal server error"}` }));
      responseStream.end();
    }
  }
);
