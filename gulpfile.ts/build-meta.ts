class BuildMeta {

  private destPath = 'dist';

  public setDestPath(path: string): void {
    this.destPath = path;
  }

  public getDestPath(): string {
    return this.destPath;
  }

  public getSrcPath(): string {
    return 'src';
  }

}

export const buildMeta = new BuildMeta();