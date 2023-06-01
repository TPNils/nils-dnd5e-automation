
import { ExecException, exec } from 'child_process';

export interface ExecResponse {
  cmd: string;
  stdout?: string;
  stderr?: string;
  err?: ExecException;
};

export class Cli {

  public execPromise(command: string): Promise<ExecResponse> {
    return new Promise<ExecResponse>((resolve, reject) => {
      exec(command, (err, stdout, stderr) => {
        resolve({
          cmd: command,
          err: err as ExecException,
          stdout,
          stderr
        });
      });
    });
  }

  public throwOnAnyError(cmd: ExecResponse): string
  public throwOnAnyError(cmd: Promise<ExecResponse>): Promise<string>
  public throwOnAnyError(cmd: ExecResponse | Promise<ExecResponse>): string | Promise<string> {
    if (cmd instanceof Promise) {
      cmd.then((c) => this.throwOnAnyError(c));
    } else {
      if (cmd.err) {
        throw cmd.err;
      }
      if (cmd.stderr) {
        throw new Error(cmd.stderr);
      }
      return cmd.cmd;
    }
  }

}

export const cli = new Cli();
for (let prop in cli) {
  if (typeof cli[prop] === 'function') {
    cli[prop] = cli[prop].bind(cli);
  }
}