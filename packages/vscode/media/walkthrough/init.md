# Start a record in this project

In a terminal at the project root, run:

    mnema init

It creates the project's `.mnema` folder, where the record is kept with the repository. Once the
folder exists, run **mnema: Refresh** from the Command Palette (or use the link in this step), or
reload the window. The extension is not running yet in a window that opened without a `.mnema` (and
until a `.mnema` exists it runs no `mnema` command, even if you open its container); the refresh
starts it, and then the views of the mnema container in the side bar list what the command line
reports: the decisions awaiting a judgment and the stacks adopted.

Nothing is recorded by opening a folder: the extension only reads, and writes only when you accept
or reject a decision, or add or remove a stack, through the same command line.
