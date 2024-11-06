import { Command, CommandType } from '../types/commands';
import { logger } from '../utils/logger';

export class CommandParser {
    static parse(text: string): Command[] {
        const commands: Command[] = [];
        
        // Look for JSON command objects in the text
        const regex = /\{[\s\S]*?\}/g;
        const matches = text.match(regex);
        
        if (!matches) {
            return commands;
        }

        for (const match of matches) {
            try {
                const command = JSON.parse(match);
                if (this.isValidCommand(command)) {
                    if (this.validateCommandParams(command)) {
                        commands.push(command);
                    } else {
                        logger.warn(`Invalid command parameters: ${JSON.stringify(command)}`);
                    }
                }
            } catch (error) {
                // If it's not valid JSON, just skip it
                continue;
            }
        }

        return commands;
    }

    private static isValidCommand(command: unknown): command is Command {
        if (typeof command !== 'object' || command === null) {
            return false;
        }

        const validTypes: CommandType[] = [
            'CREATE_FILE',
            'WRITE_TO_FILE',
            'READ_FILE',
            'DELETE_FILE',
            'EXECUTE_COMMAND'
        ];

        return (
            'type' in command &&
            'params' in command &&
            typeof (command as Command).type === 'string' &&
            validTypes.includes((command as Command).type as CommandType)
        );
    }

    private static validateCommandParams(command: Command): boolean {
        const validPathPattern = /^[a-zA-Z0-9_\-./\\]+$/;

        switch (command.type) {
            case 'CREATE_FILE':
            case 'WRITE_TO_FILE': {
                const { path, content } = command.params;
                return (
                    typeof path === 'string' &&
                    typeof content === 'string' &&
                    validPathPattern.test(path) &&
                    !path.includes('..') &&
                    !path.startsWith('/') &&
                    !path.startsWith('\\')
                );
            }
            
            case 'READ_FILE':
            case 'DELETE_FILE': {
                const { path } = command.params;
                return (
                    typeof path === 'string' &&
                    validPathPattern.test(path) &&
                    !path.includes('..') &&
                    !path.startsWith('/') &&
                    !path.startsWith('\\')
                );
            }

            case 'EXECUTE_COMMAND': {
                const { command: cmd } = command.params;
                return typeof cmd === 'string' && cmd.length > 0;
            }

            default:
                return false;
        }
    }
}