import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentRequest,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

// Initialize the Bedrock Agent Runtime client
const client = new BedrockAgentRuntimeClient();

// Main Lambda handler
export const handler = async (event: APIGatewayProxyEventV2) => {
  console.log('Received event:', { body: event.body });

  const agentId = process.env.AGENT_ID;
  const agentAliasId = process.env.AGENT_ALIAS_ID;

  // Validate environment variables
  if (!agentId || !agentAliasId) {
    console.error('Agent ID or Agent Alias ID is not configured.');
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Agent ID or Agent Alias ID is not configured.',
      }),
    };
  }

  try {
    // Validate request body
    if (!event.body) {
      console.error('Invalid input, missing request body');
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'Invalid input, missing required fields',
        }),
      };
    }

    // Parse the request body
    const request = JSON.parse(event.body);
    const { sessionAttributes, promptSessionAttributes, sessionId, prompt } =
      request;

    // Validate required fields
    if (!prompt) {
      console.error('Invalid input, missing required field: prompt');
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'Invalid input, missing required field: prompt',
        }),
      };
    }

    let fullResponse = '';
    try {
      // Prepare the input for the Bedrock Agent
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
          performanceConfig: {
            latency: 'optimized',
          },
        },
      };

      console.log('Invoking Bedrock Agent with input:', { input });

      // Invoke the Bedrock Agent
      const command = new InvokeAgentCommand(input);
      const response = await client.send(command);

      console.log(response);

      // Collect all chunks from the completion stream
      if (response.completion === undefined) {
        throw new Error('Completion is undefined');
      }

      for await (const chunkEvent of response.completion) {
        const chunk = chunkEvent.chunk;
        if (chunk) {
          const decodedResponse = new TextDecoder('utf-8').decode(chunk.bytes);
          fullResponse += decodedResponse;
        }
      }

      console.log('Full response:', fullResponse);
    } catch (error) {
      console.error('Error processing response:', error);
    }

    // Return the full response as JSON
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: fullResponse || 'SMS has been sent successfully.',
      }),
    };
  } catch (error) {
    console.error('Error invoking Bedrock Agent:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message:
          error instanceof Error ? error.message : 'Internal server error',
      }),
    };
  }
};
