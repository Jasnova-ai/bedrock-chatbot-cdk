import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentRequest,
  InvokeAgentResponse,
  ResponseStream,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { Context, APIGatewayProxyEventV2 } from "aws-lambda";
import { PassThrough } from "stream";
import { once } from "events";

const client = new BedrockAgentRuntimeClient({});

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  console.log("Received event:", event.body);

  const agentId = process.env.AGENT_ID;
  const agentAliasId = process.env.AGENT_ALIAS_ID;

  if (!agentId || !agentAliasId) {
    console.error("Agent ID or Agent Alias ID is not configured.");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Agent ID or Agent Alias ID is not configured." }),
    };
  }

  try {
    if (!event.body) {
      console.error("Invalid input, missing request body");
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Error: Missing request body." }),
      };
    }

    const request = JSON.parse(event.body);
    const { sessionAttributes, promptSessionAttributes, sessionId, prompt } = request;

    if (!prompt) {
      console.error("Invalid input, missing required field: prompt");
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Error: Missing required field: prompt." }),
      };
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
    const response: InvokeAgentResponse = await client.send(command);

    if (!response.completion) {
      console.error("Completion stream is undefined");
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Error: Bedrock response is missing the completion stream." }),
      };
    }

    const stream = new PassThrough();

    (async () => {
      try {
        for await (const chunkEvent of response.completion as AsyncIterable<ResponseStream>) {
          if (chunkEvent.chunk) {
            const decodedChunk = new TextDecoder("utf-8").decode(chunkEvent.chunk.bytes);
            console.log("Streaming chunk:", decodedChunk);
            stream.write(decodedChunk);
          }
        }
        stream.end();
      } catch (error) {
        console.error("Error streaming response:", error);
        stream.write("Error streaming response");
        stream.end();
      }
    })();

    await once(stream, "readable");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain",
        "Transfer-Encoding": "chunked",
      },
      body: stream.read().toString(),
    };
  } catch (error) {
    console.error("Error invoking Bedrock Agent:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: `Error: ${error instanceof Error ? error.message : "Internal server error"}` }),
    };
  }
};
