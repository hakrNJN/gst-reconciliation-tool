// src/core/common/errors.ts

/**
 * Base class for custom application errors.
 * Allows for operational errors (expected, like validation) vs programmer errors.
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(
        name: string,
        message: string,
        statusCode: number = 500, // Default to Internal Server Error
        isOperational: boolean = true // Assume operational unless specified
        ) {
        super(message);
        this.name = name;
        this.statusCode = statusCode;
        this.isOperational = isOperational;

        // Maintain proper stack trace (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }

        // Set the prototype explicitly for extending built-in classes
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Error for issues during configuration loading or validation.
 */
export class ConfigurationError extends AppError {
    constructor(message: string) {
        // Configuration errors are typically not operational; they prevent startup.
        super('ConfigurationError', message, 500, false);
    }
}

/**
 * Error for data validation failures.
 */
export class ValidationError extends AppError {
    constructor(message: string = 'Data validation failed') {
        super('ValidationError', message, 400, true); // 400 Bad Request
    }
}

/**
 * Error for resources not found.
 */
export class NotFoundError extends AppError {
    constructor(message: string = 'Resource not found') {
        super('NotFoundError', message, 404, true); // 404 Not Found
    }
}

/**
 * Error specifically for failures during file parsing.
 */
export class FileParsingError extends AppError {
    constructor(message: string, originalError?: Error) {
        const fullMessage = originalError
            ? `${message}: ${originalError.message}`
            : message;
        super('FileParsingError', fullMessage, 400, true); // 400 Bad Request often suitable
        if (originalError) {
            this.stack = originalError.stack; // Preserve original stack if available
        }
    }
}

// Add other specific error types as needed (e.g., AuthenticationError, AuthorizationError)