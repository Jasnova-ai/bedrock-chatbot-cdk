import { APIGatewayProxyResult } from 'aws-lambda';
import { Twilio } from 'twilio';

// Twilio Credentials (Hardcoded)
const ACCOUNT_SID = '';
const AUTH_TOKEN = '';
const FROM_NUMBER = '+';
const ACTION_GROUP_NAME = process.env.ACTION_GROUP;

// Initialize Twilio client
const twilioClient = new Twilio(ACCOUNT_SID, AUTH_TOKEN);

// Define the structure of the Bedrock Agent event
interface BedrockAgentEvent {
  requestBody: {
    content: {
      'application/json': {
        properties: Array<{
          name: string;
          type: string;
          value: string;
        }>;
      };
    };
  };
}

export const handler = async (
  event: BedrockAgentEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    // Extract the properties array from the requestBody
    const properties = event.requestBody.content['application/json'].properties;

    if (!properties) {
      console.error('Invalid input, missing request body');
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'Invalid input, missing request body',
        }),
      };
    }

    // Convert properties array to a key-value object
    const body: { [key: string]: string } = {};
    for (const prop of properties) {
      body[prop.name] = prop.value;
    }

    const { phone, name } = body;

    // Validate required fields
    if (!phone || !name) {
      console.error('Invalid input, missing required fields');
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'Invalid input, missing required fields',
        }),
      };
    }

    // Prepare the message content
    const nameParts = name.trim().split(' ');

    if (nameParts.length < 2) {
      console.error('Please provide both first and last names.');
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'Please provide both first and last names.',
        }),
      };
    }

    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' '); // Handles middle names
    const messageBody = `Hello ${firstName} ${lastName}, this is a test message from our service!`;

    // Send SMS using Twilio
    const message = await twilioClient.messages.create({
      body: messageBody,
      from: FROM_NUMBER,
      to: phone,
    });

    console.log('SMS sent successfully:', { messageSid: message.sid });

    // Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messageVersion: '1.0',
        response: {
          actionGroup: ACTION_GROUP_NAME,
          function: 'sendSms',
          functionResponse: {
            responseState: 'SUCCESS',
            responseBody: {
              'application/json': {
                message: 'SMS sent successfully',
              },
            },
          },
        },
      }),
    };
  } catch (error) {
    console.error('Error processing request:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
