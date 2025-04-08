// src/infrastructure/webserver/middleware/error.middleware.ts
import { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe'; // Import container to resolve logger
import { Logger } from 'winston';
import config from '../../../config';
import { AppError } from '../../../core/common/errors';
import { LOGGER_TOKEN } from '../../logger';

/**
 * Express error handling middleware function.
 * Must be registered AFTER all other routes and middleware.
 */
export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction // next is required even if not used for Express to recognize it as error handler
): void => {
    // Resolve logger instance within the handler
    // Ensures logger is available even if error occurs early
    const logger = container.resolve<Logger>(LOGGER_TOKEN);

    // Log the error details
    logger.error(`[ErrorHandler] ${err.name}: ${err.message}`, {
        error: {
            name: err.name,
            message: err.message,
            stack: err.stack,
            // Include specifics if it's an AppError
            ...(err instanceof AppError && {
                statusCode: err.statusCode,
                isOperational: err.isOperational,
            }),
        },
        request: {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            // body: req.body, // Be careful logging full body in production
        },
    });

    // Determine status code and response message
    let statusCode = 500;
    let message = 'An unexpected internal server error occurred.';

    if (err instanceof AppError && err.isOperational) {
        // Use status code and message from operational AppErrors
        statusCode = err.statusCode;
        message = err.message;
    }
    // Add specific checks for other error types if needed (e.g., multer errors)
    else if (err.name === 'MulterError') {
        statusCode = 400; // Bad Request for upload errors
        message = `File upload error: ${err.message}`;
    }

    // Prepare response object
    const responseJson: { message: string; error?: string; stack?: string } = {
        message: message,
    };

    // Include error details only in non-production environments for debugging
    if (config.nodeEnv !== 'production') {
        responseJson.error = err.message;
        responseJson.stack = err.stack;
    }

    // Send the response
    // Check if headers were already sent (e.g., by streaming)
    if (res.headersSent) {
       logger.warn('[ErrorHandler] Headers already sent, cannot send error response.');
       // If necessary, delegate to the default Express error handler
       // return next(err); // Be careful with this, might cause issues if response already partially sent
       return;
    }

    res.status(statusCode).json(responseJson);
};