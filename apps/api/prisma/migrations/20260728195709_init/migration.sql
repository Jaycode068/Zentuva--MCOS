-- CreateTable
CREATE TABLE "_health_check" (
    "id" SERIAL NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_health_check_pkey" PRIMARY KEY ("id")
);
